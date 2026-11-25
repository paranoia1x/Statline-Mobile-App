import { SPORTS, statDef, formatStat, type StatDef } from "@/lib/sports";
import type { Injury, Player, PlayerGameLog, SportId } from "@/lib/types";
import type { LeagueContext } from "./context";
import { clamp, countDistribution, ewma, mean, median, normCdf, sd, welchT } from "./math";
import { CURRENT_MODEL_VERSION } from "./model";

export type Direction = "over" | "under" | "neutral";

export interface Evidence {
  text: string;
  direction: Direction;
  weight: number; // 0..1 subjective strength used for ordering
  kind: "recent" | "season" | "opponent" | "venue" | "minutes" | "h2h" | "availability" | "trend" | "similar" | "sample";
}

export interface ForecastComponent {
  label: string;
  value: string;
  effect: number; // multiplicative effect on the projection (1 = none)
  note?: string;
}

export interface PlayerForecast {
  modelVersion: string;
  generatedAt: string;
  sport: SportId;
  playerId: string;
  teamId: string;
  opponentId: string;
  gameId: string | null;
  gameDate: string;
  home: boolean;
  statKey: string;
  statLabel: string;
  projection: number;
  interval80: [number, number];
  threshold: number;
  thresholdIsDefault: boolean;
  /** Where the line came from: user/PrizePicks, the player's typical line, or the projection (thin data). */
  thresholdSource: "given" | "typical" | "projection";
  /** Player is listed out for this game (the projection assumes he plays). */
  ruledOut: boolean;
  /** Regular teammates missing from this game and the share of production they leave behind. */
  teammatesOut: { share: number; players: { id: string; name: string; share: number }[] } | null;
  pOver: number;
  pUnder: number;
  pPush: number;
  rawPOver: number;
  calibration: { slope: number; samples: number } | null;
  lean: Direction;
  confidence: { level: "low" | "medium" | "high"; score: number; reasons: string[] };
  components: ForecastComponent[];
  supporting: Evidence[];
  conflicting: Evidence[];
  context: string[];
  warnings: string[];
  sample: {
    games: number;
    seasonGames: number;
    h2hGames: number;
    lastGameDate: string | null;
    daysSinceLastGame: number | null;
    dataSource: "demo" | "live";
  };
  distribution: { kind: "count" | "continuous"; mean: number; sd: number; pmf?: number[] };
  recentValues: { date: string; value: number; opponentId: string }[];
}

export interface ForecastInput {
  player: Player;
  logs: PlayerGameLog[]; // completed games strictly before the target game, oldest first
  stat: StatDef;
  opponentId: string;
  home: boolean;
  gameId: string | null;
  gameDate: string;
  ctx: LeagueContext;
  injury: Injury | null;
  threshold?: number | null;
  dataSource: "demo" | "live";
  /** Prior mean for the stat among the player's position group (shrinkage target). */
  prior?: number | null;
  /** Logit-scale calibration slope fitted by the walk-forward backtest. */
  calibrationSlope?: { slope: number; samples: number } | null;
  now?: Date;
  /** Regular teammates out for this game (see engine/teammates.ts). */
  teammatesOut?: { share: number; players: { id: string; name: string; share: number }[] } | null;
  /** Team's betting-market implied total for this game and its usual scoring (see engine/odds.ts). */
  gameEnv?: { expected: number; usual: number } | null;
  /** Days since the team's previous game. */
  restDays?: number | null;
}

const DAY = 86_400_000;

/**
 * Model settings. Tuned against the walk-forward backtest (scripts/tune-model.ts): every
 * candidate is scored on games forecast with data from before each game only.
 */
export const MODEL_PARAMS = {
  ewmaHalfLife: 14, // games (tuned; was 8)
  wRecent: 0.3, // tuned; was 0.5
  wSeason: 0.45, // tuned; was 0.35
  wCareer: 0, // tuned; was 0.15
  shrinkK: 5, // games of weight given to the position prior
  oppStrength: 0.7,
  minutesStrength: 0.6,
  meanUncertainty: 0.12,
  /**
   * How much of the production freed by absent teammates goes to each remaining player, by sport.
   * The backtest supports it in the NBA (usage clearly shifts when a star sits); in the other
   * sports it made forecasts worse, so absences are reported there but don't change projections.
   */
  teammateBoost: { nba: 0.3, nfl: 0, mlb: 0, nhl: 0, soccer: 0 } as Record<SportId, number>,
  /** Only teammates holding at least this share of team production count as a meaningful absence. */
  teammateMinShare: 0.12,
  /**
   * Elasticity of a player's stats to his team's betting-market implied total relative to what the
   * team usually scores (0 = unused). Tuned on the walk-forward backtest (scripts/tune-props.ts).
   */
  // Backtest (Nov 2026): soccer log loss 0.4698 → 0.4665, accuracy 77.8% → 78.7%; no gain in the NBA, NFL or NHL,
  // where the opponent adjustment already captures it.
  envStrength: { nba: 0, nfl: 0, mlb: 0, nhl: 0, soccer: 0.5 } as Record<SportId, number>,
  /** Multiplier on the second night of a back-to-back (1 = unused; 0.94–0.97 made NBA/NHL forecasts slightly worse). */
  backToBack: { nba: 1, nfl: 1, mlb: 1, nhl: 1, soccer: 1 } as Record<SportId, number>,
};

/** Position groups whose stats depend on the opponent's offense, not their own team's (pitchers, goalies). */
const DEFENSIVE_GROUPS = new Set(["SP", "G", "GK"]);

/** The player's typical line: median of the last 10 games, as a half-point line (same rule as the backtest). */
export function typicalLine(values: number[]): number | null {
  const last = values.slice(-10);
  if (last.length < 5) return null;
  const s = [...last].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Math.max(0.5, Math.floor(m) + 0.5);
}
const PER_MINUTE_SPORTS: SportId[] = ["nba", "nhl", "soccer", "nfl"];

export function statValue(l: PlayerGameLog, stat: StatDef): number | null {
  const v = l.stats[stat.key];
  return typeof v === "number" ? v : null;
}

export function defaultThreshold(projection: number, stat: StatDef) {
  if (stat.dist === "continuous") return Math.round(projection) + 0.5;
  return Math.max(0.5, Math.floor(projection) + 0.5);
}

export function computePlayerForecast(input: ForecastInput): PlayerForecast {
  const { player, stat, ctx, logs } = input;
  const sport = SPORTS[player.sport];
  const warnings: string[] = [];
  const context: string[] = [];
  const components: ForecastComponent[] = [];

  const played = logs.filter((l) => statValue(l, stat) != null);
  const values = played.map((l) => statValue(l, stat)!);
  const n = values.length;
  const season = played.length ? played[played.length - 1].season : null;
  const seasonLogs = played.filter((l) => l.season === season);
  const seasonVals = seasonLogs.map((l) => statValue(l, stat)!);

  // ---------- baseline ----------
  const P = MODEL_PARAMS;
  const recentEw = n ? ewma(values.slice(-40), P.ewmaHalfLife) : NaN;
  const seasonMean = seasonVals.length ? mean(seasonVals) : NaN;
  const careerMean = n ? mean(values) : NaN;
  const parts: [number, number][] = [];
  if (Number.isFinite(recentEw)) parts.push([recentEw, P.wRecent]);
  if (Number.isFinite(seasonMean)) parts.push([seasonMean, P.wSeason * Math.min(1, seasonVals.length / 10)]);
  if (Number.isFinite(careerMean)) parts.push([careerMean, P.wCareer]);
  let base = parts.length ? parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0) : NaN;
  const prior = input.prior ?? (Number.isFinite(careerMean) ? careerMean : 0);
  const k = P.shrinkK;
  base = Number.isFinite(base) ? (n * base + k * prior) / (n + k) : prior;
  components.push({
    label: "Baseline",
    value: formatStat(base, stat.format === "pct" ? "dec2" : stat.format),
    effect: 1,
    note: `Weighted recent form (EWMA ${fmt(recentEw)}), season (${fmt(seasonMean)}), career (${fmt(careerMean)}), shrunk toward position prior ${fmt(prior)} with ${n} games.`,
  });

  // ---------- playing time ----------
  let minutesAdj = 1;
  const minutes = played.map((l) => l.minutes);
  const usesMinutes = PER_MINUTE_SPORTS.includes(player.sport) || player.positionGroup === "SP";
  if (usesMinutes && minutes.length >= 8) {
    const recentMin = mean(minutes.slice(-5));
    const refMin = ewma(minutes.slice(-40), 12);
    if (refMin > 0) {
      const ratio = recentMin / refMin;
      minutesAdj = clamp(1 + P.minutesStrength * (ratio - 1), 0.75, 1.3);
      const t = welchT(minutes.slice(-5), minutes.slice(-25, -5));
      if (Math.abs(ratio - 1) > 0.12 && Math.abs(t) > 2) {
        context.push(
          `Recent role change: ${sport.playingTimeLabel.toLowerCase()} averaged ${recentMin.toFixed(1)} over the last 5 games vs ${mean(minutes.slice(-25, -5)).toFixed(1)} in the prior 20 (t = ${t.toFixed(1)}).`,
        );
      }
    }
  }
  components.push({ label: sport.playingTimeLabel, value: pctEffect(minutesAdj), effect: minutesAdj, note: "Recent playing time relative to the baseline window." });

  // ---------- availability ----------
  let availAdj = 1;
  if (input.injury) {
    const st = input.injury.status;
    availAdj = st === "out" ? 0 : st === "doubtful" ? 0.75 : st === "questionable" ? 0.9 : st === "day-to-day" ? 0.97 : 1;
    if (st === "out")
      warnings.push(
        input.injury.seasonEnding
          ? `${player.name} is OUT FOR THE SEASON (${input.injury.description}). The projection only shows what he'd produce if he played.`
          : `${player.name} is listed OUT (${input.injury.description}). A projection is shown for reference only; the player is not expected to play. Pick'em sites usually void picks on players who don't play.`,
      );
    else warnings.push(`Availability: ${st} — ${input.injury.description}. Projection reduced to reflect possible limited playing time.`);
  }
  const effectiveAvail = availAdj === 0 ? 1 : availAdj;
  components.push({ label: "Availability", value: input.injury ? `${input.injury.status} (${pctEffect(effectiveAvail)})` : "No listed injury", effect: effectiveAvail });

  // ---------- teammates out ----------
  let mateAdj = 1;
  const mates = input.teammatesOut && input.teammatesOut.share > 0 ? input.teammatesOut : null;
  if (mates) {
    mateAdj = clamp(1 + (P.teammateBoost[player.sport] ?? 0) * (mates.share / (1 - mates.share)), 1, 1.45);
    const names = mates.players.slice(0, 3).map((x) => x.name).join(", ");
    context.push(`${names}${mates.players.length > 3 ? " and others" : ""} ${mates.players.length === 1 ? "is" : "are"} out — about ${Math.round(mates.share * 100)}% of the team's ${stat.label.toLowerCase()} — so more opportunity goes to the players who remain.`);
  }
  components.push({
    label: "Teammates out",
    value: mates ? `${Math.round(mates.share * 100)}% of team ${stat.short} missing (${mateAdj > 1 ? pctEffect(mateAdj) : "noted, no adjustment in this sport"})` : "No key teammates out",
    effect: mateAdj,
    note: "Share of the team's recent production in this stat held by regulars who are out; part of it goes to remaining players.",
  });

  // ---------- opponent ----------
  let oppAdj = 1;
  let oppIdx: ReturnType<LeagueContext["dimIndex"]> = null;
  const dimDef = sport.dims.find((d) => d.id === stat.dim);
  if (stat.dim) {
    oppIdx = ctx.dimIndex(input.opponentId, stat.dim);
    if (oppIdx) oppAdj = clamp(1 + P.oppStrength * (oppIdx.index - 1), 0.8, 1.25);
  }
  components.push({
    label: "Opponent",
    value: oppIdx ? `${dimDef?.label}: ${oppIdx.raw!.toFixed(1)} vs league ${oppIdx.league!.toFixed(1)} (${pctEffect(oppAdj)})` : "No opponent data",
    effect: oppAdj,
  });

  // ---------- game environment (betting-market team total) ----------
  let envAdj = 1;
  const envK = P.envStrength[player.sport] ?? 0;
  const env = input.gameEnv && input.gameEnv.usual > 0 && !DEFENSIVE_GROUPS.has(player.positionGroup) ? input.gameEnv : null;
  if (env && envK) envAdj = clamp(Math.pow(env.expected / env.usual, envK), 0.85, 1.18);
  components.push({
    label: "Game environment",
    value: env ? `Team implied total ${env.expected.toFixed(1)} vs usual ${env.usual.toFixed(1)} (${envK ? pctEffect(envAdj) : "context only"})` : "No betting line for this game",
    effect: envAdj,
    note: "The betting market's expected score for the team prices in both teams, pace, injuries and weather.",
  });

  // ---------- rest ----------
  let restAdj = 1;
  const b2b = P.backToBack[player.sport] ?? 1;
  if (b2b !== 1 && input.restDays != null && input.restDays < 1.6) {
    restAdj = b2b;
    context.push("Second night of a back-to-back: production is typically a little lower.");
  }
  if (b2b !== 1) components.push({ label: "Rest", value: input.restDays == null ? "Unknown" : input.restDays < 1.6 ? `Back-to-back (${pctEffect(restAdj)})` : `${Math.round(input.restDays)} days`, effect: restAdj });

  // ---------- venue ----------
  const venueLogs = played.filter((l) => l.home === input.home);
  let venueAdj = 1;
  if (venueLogs.length >= 3 && careerMean > 0) {
    const r = mean(venueLogs.map((l) => statValue(l, stat)!)) / careerMean;
    const w = venueLogs.length / (venueLogs.length + 25);
    const leagueVenue = input.home ? Math.sqrt(ctx.homeEdge) : 1 / Math.sqrt(ctx.homeEdge);
    venueAdj = clamp(1 + w * (r - 1) + (1 - w) * (leagueVenue - 1) * 0.5, 0.88, 1.12);
  }
  components.push({ label: input.home ? "Home" : "Away", value: pctEffect(venueAdj), effect: venueAdj, note: "Player's own venue split, shrunk toward the league home edge." });

  // ---------- head to head ----------
  const h2h = played.filter((l) => l.opponentId === input.opponentId);
  const h2hVals = h2h.map((l) => statValue(l, stat)!);
  let h2hAdj = 1;
  if (h2h.length >= 2 && careerMean > 0) {
    const r = mean(h2hVals) / careerMean;
    const w = 0.15 * (h2h.length / (h2h.length + 6));
    h2hAdj = clamp(1 + w * (r - 1), 0.93, 1.07);
  }
  components.push({ label: "Head-to-head", value: h2h.length ? `${h2h.length} games, avg ${fmt(mean(h2hVals))} (${pctEffect(h2hAdj)})` : "No prior meetings", effect: h2hAdj, note: "Deliberately small weight: head-to-head samples are short and noisy." });

  // ---------- projection & distribution ----------
  const mu = Math.max(0, base * minutesAdj * effectiveAvail * mateAdj * oppAdj * envAdj * restAdj * venueAdj * h2hAdj);
  const recentForSpread = values.slice(-30);
  const cvRaw = recentForSpread.length >= 5 && mean(recentForSpread) > 0 ? sd(recentForSpread) / mean(recentForSpread) : 0.6;
  const cv = clamp(Number.isFinite(cvRaw) ? cvRaw : 0.6, 0.12, 2.5);
  const isCount = stat.dist === "count" && !stat.ratio;
  let variance = (cv * Math.max(mu, 0.05)) ** 2;
  if (isCount) variance = Math.max(variance, mu * 1.02);
  // uncertainty in the mean itself
  variance += (mu * P.meanUncertainty) ** 2 / Math.max(1, n / 10);
  const sigma = Math.sqrt(variance);

  // Default line: the player's typical line (median of the last 10 games). A line at the model's
  // own projection would put every forecast at ~50% by construction.
  const thresholdIsDefault = input.threshold == null || !Number.isFinite(input.threshold);
  const typical = thresholdIsDefault ? typicalLine(values) : null;
  const threshold = !thresholdIsDefault ? (input.threshold as number) : typical ?? defaultThreshold(mu, stat);
  const thresholdSource: PlayerForecast["thresholdSource"] = !thresholdIsDefault ? "given" : typical != null ? "typical" : "projection";

  let pOver: number;
  let pUnder: number;
  let pPush = 0;
  let pmf: number[] | undefined;
  let lo: number;
  let hi: number;
  if (isCount) {
    pmf = countDistribution(mu, variance);
    const cdf = (x: number) => pmf!.slice(0, Math.floor(x) + 1).reduce((a, b) => a + b, 0);
    if (Number.isInteger(threshold)) {
      pPush = pmf[threshold] ?? 0;
      pUnder = cdf(threshold - 1);
      pOver = 1 - pUnder - pPush;
    } else {
      pUnder = cdf(threshold);
      pOver = 1 - pUnder;
    }
    lo = quantileFromPmf(pmf, 0.1);
    hi = quantileFromPmf(pmf, 0.9);
  } else {
    pOver = 1 - normCdf(threshold, mu, sigma);
    pUnder = 1 - pOver;
    lo = Math.max(0, mu - 1.2816 * sigma);
    hi = mu + 1.2816 * sigma;
  }
  const rawPOver = pOver;

  // ---------- calibration (from walk-forward backtest) ----------
  const cal = input.calibrationSlope ?? null;
  if (cal && cal.samples >= 50) {
    const decided = 1 - pPush;
    if (decided > 0) {
      const po = pOver / decided;
      const calibrated = 1 / (1 + Math.exp(-cal.slope * Math.log(Math.max(1e-6, po) / Math.max(1e-6, 1 - po))));
      pOver = calibrated * decided;
      pUnder = (1 - calibrated) * decided;
    }
  }

  const lean: Direction = Math.abs(pOver - pUnder) < 0.04 ? "neutral" : pOver > pUnder ? "over" : "under";

  // ---------- evidence ----------
  const ev: Evidence[] = [];
  const dirOf = (v: number) => (v > threshold ? "over" : v < threshold ? "under" : "neutral") as Direction;
  const addAvg = (label: string, vals: number[], kind: Evidence["kind"], weight: number) => {
    if (!vals.length) return;
    const m = mean(vals);
    ev.push({ text: `${label}: averaged ${fmt(m)} ${stat.label.toLowerCase()} (${vals.length} games) vs threshold ${threshold}.`, direction: dirOf(m), weight, kind });
  };
  addAvg("Last 5 games", values.slice(-5), "recent", 0.45);
  addAvg("Last 10 games", values.slice(-10), "recent", 0.55);
  addAvg(`Season ${season ?? ""}`.trim(), seasonVals, "season", 0.7);
  const last10 = values.slice(-10);
  if (last10.length >= 5) {
    const overs = last10.filter((v) => v > threshold).length;
    const unders = last10.filter((v) => v < threshold).length;
    ev.push({
      text: `Exceeded ${threshold} in ${overs} of last ${last10.length} games (fell below in ${unders}). Small-sample hit rates are noisy.`,
      direction: overs > unders ? "over" : unders > overs ? "under" : "neutral",
      weight: 0.3,
      kind: "recent",
    });
  }
  if (oppIdx && dimDef) {
    const pct = (oppIdx.index - 1) * 100;
    if (Math.abs(pct) >= 3)
      ev.push({
        text: `Opponent ${dimDef.source === "allowed" ? "allows" : "generates"} ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "more" : "less"} ${dimDef.label.replace(/ allowed$/i, "").toLowerCase()} than league average (last ${oppIdx.games} games).`,
        direction: pct > 0 ? "over" : "under",
        weight: Math.min(0.9, Math.abs(pct) / 15),
        kind: "opponent",
      });
  }
  if (venueLogs.length >= 3) addAvg(input.home ? "At home (all seasons)" : "On the road (all seasons)", venueLogs.map((l) => statValue(l, stat)!), "venue", 0.25);
  if (h2hVals.length) addAvg(`Versus this opponent`, h2hVals, "h2h", 0.2 * Math.min(1, h2hVals.length / 5));
  if (minutesAdj !== 1 && Math.abs(minutesAdj - 1) >= 0.04)
    ev.push({
      text: `${sport.playingTimeLabel} trending ${minutesAdj > 1 ? "up" : "down"} (${pctEffect(minutesAdj)} applied to projection).`,
      direction: minutesAdj > 1 ? "over" : "under",
      weight: Math.min(0.8, Math.abs(minutesAdj - 1) * 4),
      kind: "minutes",
    });
  // similar opponents
  if (stat.dim && oppIdx) {
    const similar = played.filter((l) => {
      const ix = ctx.dimIndex(l.opponentId, stat.dim!);
      return ix && Math.abs(ix.index - oppIdx!.index) < 0.04 && l.opponentId !== input.opponentId;
    });
    if (similar.length >= 3) addAvg("Against opponents with a similar profile", similar.slice(-15).map((l) => statValue(l, stat)!), "similar", 0.35);
  }
  if (env && Math.abs(envAdj - 1) >= 0.02)
    ev.push({
      text: `Betting market expects ${env.expected.toFixed(1)} from the team vs its usual ${env.usual.toFixed(1)} (${pctEffect(envAdj)} applied).`,
      direction: envAdj > 1 ? "over" : "under",
      weight: Math.min(0.8, Math.abs(envAdj - 1) * 5),
      kind: "opponent",
    });
  if (mates && mateAdj > 1.02)
    ev.push({
      text: `${mates.players.slice(0, 2).map((x) => x.name).join(" and ")} ${mates.players.length === 1 ? "is" : "are"} out (${Math.round(mates.share * 100)}% of the team's ${stat.label.toLowerCase()}); projection raised ${pctEffect(mateAdj)}.`,
      direction: "over",
      weight: Math.min(0.9, (mateAdj - 1) * 3),
      kind: "availability",
    });
  if (input.injury && input.injury.status !== "out")
    ev.push({ text: `Listed ${input.injury.status}: ${input.injury.description}. Playing time may be limited.`, direction: "under", weight: 0.6, kind: "availability" });
  const slopeVals = values.slice(-15);
  if (slopeVals.length >= 10) {
    const t = welchT(values.slice(-5), values.slice(-15, -5));
    if (Math.abs(t) > 2)
      ev.push({ text: `Last 5 games differ from the prior 10 by a statistically notable margin (t = ${t.toFixed(1)}).`, direction: t > 0 ? "over" : "under", weight: 0.4, kind: "trend" });
  }

  // streak caution (gambler's fallacy guard)
  const lastDir: Direction = values.length ? dirOf(values[values.length - 1]) : "neutral";
  let streak = 0;
  if (lastDir !== "neutral") for (let i = values.length - 1; i >= 0 && dirOf(values[i]) === lastDir; i--) streak++;
  if (streak >= 4)
    context.push(
      `Has finished ${lastDir === "over" ? "above" : "below"} ${threshold} in ${streak} straight games. Streaks alone are not treated as predictive; the model uses underlying rates, opponent and playing time.`,
    );

  const supporting = ev.filter((e) => lean !== "neutral" && e.direction === lean).sort((a, b) => b.weight - a.weight);
  const conflicting = ev.filter((e) => lean !== "neutral" && e.direction !== lean && e.direction !== "neutral").sort((a, b) => b.weight - a.weight);
  if (lean === "neutral") supporting.push(...ev.filter((e) => e.direction !== "neutral"));

  // ---------- sample & freshness ----------
  const lastDate = played.length ? played[played.length - 1].date : null;
  const now = input.now ?? new Date();
  const ref = Math.min(now.getTime(), Date.parse(input.gameDate));
  const daysSince = lastDate ? Math.round((ref - Date.parse(lastDate)) / DAY) : null;
  if (n < 10) warnings.push(`Small sample: only ${n} completed games with this statistic.`);
  if (daysSince != null && daysSince > 14) warnings.push(`Data freshness: last game was ${daysSince} days before this matchup.`);

  // ---------- confidence ----------
  let score = 75;
  const reasons: string[] = [];
  if (n < 10) (score -= 25), reasons.push("small sample");
  else if (n < 20) (score -= 10), reasons.push("limited sample");
  if (cv > 0.9) (score -= 20), reasons.push("highly volatile statistic");
  else if (cv > 0.55) (score -= 10), reasons.push("moderately volatile statistic");
  if (input.injury) {
    const pen = input.injury.status === "out" ? 50 : input.injury.status === "doubtful" ? 25 : input.injury.status === "questionable" ? 15 : 5;
    score -= pen;
    reasons.push(`availability (${input.injury.status})`);
  }
  if (context.some((c) => c.startsWith("Recent role change"))) (score -= 10), reasons.push("recent role change");
  if (daysSince != null && daysSince > 14) (score -= 10), reasons.push("stale data");
  if (!oppIdx && stat.dim) (score -= 5), reasons.push("no opponent profile");
  if (cal && cal.slope < 0.8) (score -= 5), reasons.push("model historically over-confident on this stat");
  if (!reasons.length) reasons.push("adequate sample, stable role and full availability");
  score = clamp(score, 5, 95);
  const level = score >= 68 ? "high" : score >= 45 ? "medium" : "low";

  return {
    modelVersion: CURRENT_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    sport: player.sport,
    playerId: player.id,
    teamId: player.teamId,
    opponentId: input.opponentId,
    gameId: input.gameId,
    gameDate: input.gameDate,
    home: input.home,
    statKey: stat.key,
    statLabel: stat.label,
    projection: mu,
    interval80: [lo, hi],
    threshold,
    thresholdIsDefault,
    thresholdSource,
    ruledOut: input.injury?.status === "out",
    teammatesOut: mates,
    pOver,
    pUnder,
    pPush,
    rawPOver,
    calibration: cal,
    lean,
    confidence: { level, score, reasons },
    components,
    supporting,
    conflicting,
    context,
    warnings,
    sample: {
      games: n,
      seasonGames: seasonVals.length,
      h2hGames: h2h.length,
      lastGameDate: lastDate,
      daysSinceLastGame: daysSince,
      dataSource: input.dataSource,
    },
    distribution: { kind: isCount ? "count" : "continuous", mean: mu, sd: sigma, pmf: pmf?.slice(0, Math.min(pmf.length, Math.ceil(hi * 1.6) + 3)) },
    recentValues: played.slice(-20).map((l) => ({ date: l.date, value: statValue(l, stat)!, opponentId: l.opponentId })),
  };
}

function quantileFromPmf(pmf: number[], q: number) {
  let c = 0;
  for (let i = 0; i < pmf.length; i++) {
    c += pmf[i];
    if (c >= q) return i;
  }
  return pmf.length - 1;
}

function fmt(v: number) {
  return Number.isFinite(v) ? (Math.abs(v) < 1 && v !== 0 ? v.toFixed(2) : v.toFixed(1)) : "—";
}
function pctEffect(m: number) {
  const p = (m - 1) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export { median, statDef };
