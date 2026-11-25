/**
 * Walk-forward backtest of the fantasy projections: each recent game is projected using only
 * games played before it, then compared with what the player actually scored. Reported against
 * two simple baselines people use (season average and last-5 average) so the gain is visible.
 */
import type { SportId } from "@/lib/types";
import { mean } from "@/lib/engine/math";
import { getFormat } from "./formats";
import { FANTASY_PARAMS, loadFantasyData, positionPrior, projectFantasy, type FantasyData, type FantasyParams } from "./engine";

export interface FantasySample {
  playerId: string;
  group: string;
  slate: string;
  date: string;
  pred: number;
  seasonAvg: number;
  last5: number;
  actual: number;
}

export interface FantasyAccuracy {
  sport: SportId;
  format: string;
  n: number;
  mae: number;
  maeSeason: number;
  maeLast5: number;
  /** Share of same-slate, same-position pairs where the higher projection scored more (fantasy-relevant players). */
  startSit: number | null;
  startSitSeason: number | null;
  pairs: number;
  byGroup: Record<string, { n: number; mae: number; maeSeason: number }>;
}

/** Week (NFL) or day (other sports) a game belongs to, for start/sit comparisons. */
export function slateOf(sport: SportId, date: string) {
  const t = Date.parse(date) - 6 * 3600_000; // late games belong to the US day they start on
  if (sport !== "nfl") return new Date(t).toISOString().slice(0, 10);
  return String(Math.floor((t - Date.UTC(2020, 0, 1)) / (7 * 86_400_000) + 0.5)); // Thu–Mon in one bucket
}

export function backtestSamples(data: FantasyData, params: FantasyParams, gamesPerPlayer = 8): FantasySample[] {
  const out: FantasySample[] = [];
  for (const [pid, rows] of data.byPlayer) {
    if (rows.length < 6) continue;
    for (const target of rows.slice(-gamesPerPlayer)) {
      const history = rows.filter((r) => r.date < target.date);
      if (history.length < 4) continue;
      const game = data.gameById.get(target.gameId);
      if (!game) continue;
      const f = projectFantasy({ data, params, playerId: pid, group: target.group, teamId: target.teamId, game, history, prior: positionPrior(data, target.group, target.date) });
      const season = history.filter((r) => r.season === target.season);
      const ref = season.length >= 2 ? season : history.slice(-10);
      out.push({
        playerId: pid, group: target.group, slate: slateOf(data.sport, target.date), date: target.date, pred: f.points,
        seasonAvg: mean(ref.map((r) => r.fp)), last5: mean(history.slice(-5).map((r) => r.fp)), actual: target.fp,
      });
    }
  }
  return out;
}

export function summarize(sport: SportId, format: string, ss: FantasySample[]): FantasyAccuracy {
  const mae = (f: (s: FantasySample) => number, xs = ss) => (xs.length ? mean(xs.map((s) => Math.abs(f(s) - s.actual))) : NaN);
  const byGroup: FantasyAccuracy["byGroup"] = {};
  for (const g of new Set(ss.map((s) => s.group))) {
    const xs = ss.filter((s) => s.group === g);
    byGroup[g] = { n: xs.length, mae: mae((s) => s.pred, xs), maeSeason: mae((s) => s.seasonAvg, xs) };
  }
  // start/sit: compare players who'd plausibly be in a lineup (season average in the top half of their position)
  const cut = new Map<string, number>();
  for (const g of Object.keys(byGroup)) {
    const v = ss.filter((s) => s.group === g).map((s) => s.seasonAvg).sort((a, b) => a - b);
    cut.set(g, v[Math.floor(v.length / 2)] ?? 0);
  }
  const buckets = new Map<string, FantasySample[]>();
  for (const s of ss) if (s.seasonAvg >= (cut.get(s.group) ?? 0)) (buckets.get(`${s.slate}|${s.group}`) ?? buckets.set(`${s.slate}|${s.group}`, []).get(`${s.slate}|${s.group}`)!).push(s);
  let pairs = 0, right = 0, rightSeason = 0;
  for (const xs of buckets.values())
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) {
        const a = xs[i], b = xs[j];
        if (a.actual === b.actual) continue;
        pairs++;
        const better = a.actual > b.actual;
        if (a.pred > b.pred === better) right++;
        if (a.seasonAvg > b.seasonAvg === better) rightSeason++;
      }
  return {
    sport, format, n: ss.length, mae: mae((s) => s.pred), maeSeason: mae((s) => s.seasonAvg), maeLast5: mae((s) => s.last5),
    startSit: pairs ? right / pairs : null, startSitSeason: pairs ? rightSeason / pairs : null, pairs, byGroup,
  };
}

/**
 * Accuracy shown in the app: the most recent 30% of backtest games — the part the settings were
 * checked on, not tuned on.
 */
export async function fantasyBacktest(sport: SportId, formatId?: string, params: FantasyParams = FANTASY_PARAMS[sport]): Promise<FantasyAccuracy> {
  const format = getFormat(formatId, sport);
  const data = await loadFantasyData(sport, format);
  const ss = backtestSamples(data, params);
  const dates = ss.map((s) => s.date).sort();
  const cutoff = dates[Math.floor(dates.length * 0.7)] ?? "";
  return summarize(sport, format.id, ss.filter((s) => s.date >= cutoff));
}
