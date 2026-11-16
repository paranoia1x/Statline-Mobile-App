import { getProvider } from "@/lib/data";
import { teammatesOut } from "./teammates";
import { SPORTS, statDef } from "@/lib/sports";
import type { Player, SportId } from "@/lib/types";
import type { Prediction } from "@/lib/store/types";
import { getLeagueContext } from "./context";
import { clamp, logit, median, sigmoid } from "./math";
import { computePlayerForecast } from "./player-forecast";
import { labelFor, strengthOf, type TrackRecord } from "./verdict";

// ---------------- metrics shared by backtests and user tracking ----------------
export interface CalibrationBin {
  lo: number;
  hi: number;
  count: number;
  avgPredicted: number | null;
  observed: number | null;
}

export interface ScoredSample {
  p: number; // predicted probability of the tracked/leaned side
  hit: 0 | 1;
}

export function calibrationBins(samples: ScoredSample[], edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.0001]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  // fold probabilities below 0.5 onto the other side so bins describe confidence in the chosen side
  const folded = samples.map((s) => (s.p >= 0.5 ? s : { p: 1 - s.p, hit: (1 - s.hit) as 0 | 1 }));
  for (let i = 0; i < edges.length - 1; i++) {
    const inBin = folded.filter((s) => s.p >= edges[i] && s.p < edges[i + 1]);
    bins.push({
      lo: edges[i],
      hi: Math.min(1, edges[i + 1]),
      count: inBin.length,
      avgPredicted: inBin.length ? inBin.reduce((a, s) => a + s.p, 0) / inBin.length : null,
      observed: inBin.length ? inBin.reduce((a, s) => a + s.hit, 0) / inBin.length : null,
    });
  }
  return bins;
}

export function brier(samples: ScoredSample[]) {
  return samples.length ? samples.reduce((a, s) => a + (s.p - s.hit) ** 2, 0) / samples.length : null;
}
export function logLoss(samples: ScoredSample[]) {
  if (!samples.length) return null;
  return -samples.reduce((a, s) => a + Math.log(clamp(s.hit ? s.p : 1 - s.p, 1e-6, 1)), 0) / samples.length;
}

// ---------------- walk-forward backtest ----------------
export interface BacktestSample {
  sport: SportId;
  statKey: string;
  playerId: string;
  gameId: string;
  date: string;
  threshold: number;
  rawPOver: number;
  outcome: "over" | "under" | "push";
  confidence: "low" | "medium" | "high";
}

export interface BacktestResult {
  sport: SportId;
  generatedAt: string;
  samples: BacktestSample[];
  slope: number;
  byStat: Record<string, { slope: number; n: number }>;
  metrics: {
    n: number;
    accuracy: number | null;
    brierRaw: number | null;
    brierCalibrated: number | null;
    brierBaseline: number; // always-50% reference
    logLoss: number | null;
  };
  bins: CalibrationBin[];
  byConfidence: Record<string, { n: number; accuracy: number | null }>;
  /** How often the favoured side happened, by verdict strength ("Likely" / "Lean" / "Toss-up"). */
  verdictTrack: TrackRecord;
}

const BT_TTL = 6 * 3600_000;
const precomputed = new Map<SportId, BacktestResult>();
/** Install backtest results computed by the data job (samples omitted). */
export function setPrecomputedBacktest(results: BacktestResult[]) {
  for (const r of results) precomputed.set(r.sport, r);
}
const g = globalThis as unknown as { __bt?: Map<string, { at: number; p: Promise<BacktestResult> }> };
g.__bt ??= new Map();

/**
 * Walk-forward backtest: for each player's recent completed games, forecast
 * using only data available before that game, against a hypothetical
 * threshold set at the median of their prior 10 games (+0.5). Used for
 * probability calibration and the "model performance" panels.
 */
/** Forget cached backtests (used when model settings change, e.g. while tuning). */
export function clearBacktestCache() {
  g.__bt!.clear();
}

export function runBacktest(sport: SportId): Promise<BacktestResult> {
  // the app uses the results the data job computed (a full backtest is too heavy for a phone)
  const pre = precomputed.get(sport);
  if (pre) return Promise.resolve(pre);
  const hit = g.__bt!.get(sport);
  if (hit && Date.now() - hit.at < BT_TTL) return hit.p;
  const p = doBacktest(sport);
  g.__bt!.set(sport, { at: Date.now(), p });
  p.catch(() => g.__bt!.delete(sport));
  return p;
}

const GAMES_PER_PLAYER = 6;

async function doBacktest(sport: SportId): Promise<BacktestResult> {
  const prov = getProvider();
  const players = await prov.listPlayers({ sport });
  // players are evaluated in parallel (short await chains; React dev mode chokes on very long ones)
  const perPlayer = await Promise.all(players.map((player) => backtestPlayer(sport, player)));
  const samples: BacktestSample[] = perPlayer.flat();
  const decided = samples.filter((s) => s.outcome !== "push");
  const fit = (ss: BacktestSample[]) => fitSlope(ss.map((s) => ({ p: clamp(s.rawPOver, 0.01, 0.99), hit: (s.outcome === "over" ? 1 : 0) as 0 | 1 })));
  const slope = fit(decided);
  const byStat: Record<string, { slope: number; n: number }> = {};
  for (const key of new Set(decided.map((s) => s.statKey))) {
    const ss = decided.filter((s) => s.statKey === key);
    byStat[key] = { slope: ss.length >= 120 ? fit(ss) : slope, n: ss.length };
  }
  const scoredRaw = decided.map((s) => ({ p: clamp(s.rawPOver, 0.001, 0.999), hit: (s.outcome === "over" ? 1 : 0) as 0 | 1 }));
  const scoredCal = decided.map((s) => ({ p: sigmoid((byStat[s.statKey]?.slope ?? slope) * logit(clamp(s.rawPOver, 0.001, 0.999))), hit: (s.outcome === "over" ? 1 : 0) as 0 | 1 }));
  const correct = scoredCal.filter((s) => (s.p >= 0.5 ? s.hit === 1 : s.hit === 0)).length;
  const byConfidence: BacktestResult["byConfidence"] = {};
  for (const lvl of ["high", "medium", "low"]) {
    const idx = decided.map((s, i) => (s.confidence === lvl ? i : -1)).filter((i) => i >= 0);
    const c = idx.filter((i) => (scoredCal[i].p >= 0.5 ? scoredCal[i].hit === 1 : scoredCal[i].hit === 0)).length;
    byConfidence[lvl] = { n: idx.length, accuracy: idx.length ? c / idx.length : null };
  }
  const verdictTrack: TrackRecord = { likely: { n: 0, rate: null }, lean: { n: 0, rate: null }, tossup: { n: 0, rate: null } };
  const right: Record<string, number> = { likely: 0, lean: 0, tossup: 0 };
  decided.forEach((s, i) => {
    const p = scoredCal[i].p;
    const fav = Math.max(p, 1 - p);
    const k = strengthOf(fav, s.confidence);
    verdictTrack[k].n++;
    if ((p >= 0.5 ? scoredCal[i].hit === 1 : scoredCal[i].hit === 0)) right[k]++;
  });
  for (const k of ["likely", "lean", "tossup"] as const) verdictTrack[k].rate = verdictTrack[k].n ? right[k] / verdictTrack[k].n : null;

  return {
    sport,
    generatedAt: new Date().toISOString(),
    verdictTrack,
    samples,
    slope,
    byStat,
    metrics: {
      n: decided.length,
      accuracy: decided.length ? correct / decided.length : null,
      brierRaw: brier(scoredRaw),
      brierCalibrated: brier(scoredCal),
      brierBaseline: 0.25,
      logLoss: logLoss(scoredCal),
    },
    bins: calibrationBins(scoredCal),
    byConfidence,
  };
}

async function backtestPlayer(sport: SportId, player: Player): Promise<BacktestSample[]> {
  const prov = getProvider();
  const samples: BacktestSample[] = [];
    const logs = await prov.getPlayerLogs(player.id);
    if (logs.length < 14) return samples;
    const head = (SPORTS[sport].headline[player.positionGroup] ?? []).map((k) => statDef(sport, k)).filter((s) => s && s.forecastable).slice(0, 2);
    const targets = logs.slice(-GAMES_PER_PLAYER);
    for (const target of targets) {
      const prior = logs.filter((l) => l.date < target.date);
      if (prior.length < 8) continue;
      const ctx = await getLeagueContext(sport, target.date);
      const targetGame = await prov.getGame(target.gameId);
      for (const stat of head) {
        if (!stat) continue;
        const prevVals = prior.slice(-10).map((l) => l.stats[stat.key]).filter((v): v is number => typeof v === "number");
        const actual = target.stats[stat.key];
        if (prevVals.length < 5 || typeof actual !== "number") continue;
        const m = median(prevVals);
        const threshold = Math.max(0.5, Math.floor(m) + 0.5);
        const mates = targetGame ? await teammatesOut(player, stat.key, targetGame).catch(() => null) : null;
        const f = computePlayerForecast({
          player, logs: prior, stat, opponentId: target.opponentId, home: target.home, gameId: target.gameId,
          gameDate: target.date, ctx, injury: null, threshold, dataSource: prov.isDemo ? "demo" : "live", teammatesOut: mates,
        });
        samples.push({
          sport, statKey: stat.key, playerId: player.id, gameId: target.gameId, date: target.date, threshold,
          rawPOver: f.rawPOver, outcome: actual > threshold ? "over" : actual < threshold ? "under" : "push",
          confidence: f.confidence.level,
        });
      }
    }
    return samples;
}

/** One-parameter logit-slope calibration (Platt scaling without intercept) via grid search. */
function fitSlope(samples: ScoredSample[]) {
  if (samples.length < 30) return 1;
  let best = 1;
  let bestLoss = Infinity;
  for (let a = 0.3; a <= 1.6001; a += 0.05) {
    const loss = logLoss(samples.map((s) => ({ p: sigmoid(a * logit(s.p)), hit: s.hit })))!;
    if (loss < bestLoss) {
      bestLoss = loss;
      best = a;
    }
  }
  return Math.round(best * 100) / 100;
}

export async function getTrackRecord(sport: SportId): Promise<TrackRecord | null> {
  try {
    return (await runBacktest(sport)).verdictTrack;
  } catch {
    return null;
  }
}

export async function getCalibration(sport: SportId, statKey: string): Promise<{ slope: number; samples: number } | null> {
  try {
    const bt = await runBacktest(sport);
    const s = bt.byStat[statKey];
    return { slope: s?.slope ?? bt.slope, samples: s?.n ?? bt.metrics.n };
  } catch {
    return null;
  }
}

// ---------------- user prediction tracking ----------------
export interface TrackerSummary {
  total: number;
  correct: number;
  incorrect: number;
  push: number;
  void: number;
  pending: number;
  accuracy: number | null;
  brier: number | null;
  bySport: { key: string; label: string; n: number; correct: number; accuracy: number | null }[];
  byStat: { key: string; label: string; n: number; correct: number; accuracy: number | null }[];
  byConfidence: { key: string; label: string; n: number; correct: number; accuracy: number | null }[];
  byVerdict: { key: string; label: string; n: number; correct: number; accuracy: number | null }[];
  bins: CalibrationBin[];
  timeline: { date: string; cumulativeAccuracy: number; graded: number }[];
}

export function summarizePredictions(preds: Prediction[]): TrackerSummary {
  const graded = preds.filter((p) => p.status === "correct" || p.status === "incorrect");
  const group = (keyOf: (p: Prediction) => string, labelOf: (k: string) => string) => {
    const keys = [...new Set(preds.map(keyOf))];
    return keys
      .map((k) => {
        const gs = graded.filter((p) => keyOf(p) === k);
        const c = gs.filter((p) => p.status === "correct").length;
        return { key: k, label: labelOf(k), n: gs.length, correct: c, accuracy: gs.length ? c / gs.length : null };
      })
      .sort((a, b) => b.n - a.n);
  };
  const samples = graded.map((p) => ({ p: p.probability, hit: (p.status === "correct" ? 1 : 0) as 0 | 1 }));
  const sorted = [...graded].sort((a, b) => (a.gradedAt ?? a.gameDate).localeCompare(b.gradedAt ?? b.gameDate));
  let c = 0;
  const timeline = sorted.map((p, i) => {
    if (p.status === "correct") c++;
    return { date: p.gameDate, cumulativeAccuracy: c / (i + 1), graded: i + 1 };
  });
  return {
    total: preds.length,
    correct: graded.filter((p) => p.status === "correct").length,
    incorrect: graded.filter((p) => p.status === "incorrect").length,
    push: preds.filter((p) => p.status === "push").length,
    void: preds.filter((p) => p.status === "void").length,
    pending: preds.filter((p) => p.status === "pending").length,
    accuracy: graded.length ? graded.filter((p) => p.status === "correct").length / graded.length : null,
    brier: brier(samples),
    bySport: group((p) => p.sport, (k) => SPORTS[k as SportId]?.name ?? k),
    byStat: group(
      (p) => (p.kind === "player_stat" ? `${p.sport}:${p.statKey}` : `${p.sport}:${p.kind}`),
      (k) => {
        const [sp, key] = k.split(":");
        if (key === "game_winner") return `${SPORTS[sp as SportId]?.name} · Game winner`;
        if (key === "game_total") return `${SPORTS[sp as SportId]?.name} · Game total`;
        return `${SPORTS[sp as SportId]?.name} · ${statDef(sp as SportId, key)?.label ?? key}`;
      },
    ),
    byConfidence: group((p) => p.confidence, (k) => k[0].toUpperCase() + k.slice(1)),
    byVerdict: group((p) => labelFor(p.probability, p.confidence), (k) => k),
    bins: calibrationBins(samples),
    timeline,
  };
}
