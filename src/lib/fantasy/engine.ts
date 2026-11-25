/**
 * Fantasy projection engine.
 *
 * For every player it rebuilds a game-by-game history of fantasy points in the chosen scoring
 * format, then projects the next game:
 *
 *   baseline     recent form (EWMA) + season average, shrunk toward the position average
 *   × role       playing-time trend (minutes / NFL opportunities)
 *   × matchup    defense vs position: fantasy points the opponent allows to this position
 *   × game env.  the team's expected score (betting-market implied total when available,
 *                otherwise the team model) relative to what the team usually scores
 *   × rest       back-to-backs (NBA, NHL)
 *   × weather    wind / rain / snow / cold at outdoor NFL stadiums
 *   × health     injury status and key teammates out
 *
 * Strengths of the matchup, game-environment, rest and form terms were chosen on a walk-forward
 * backtest of real games (each game projected only from data before it); see FANTASY_PARAMS.
 */
import { getProvider } from "@/lib/data";
import type { Game, GameWeather, Injury, Player, PlayerGameLog, SportId, TeamGameLog } from "@/lib/types";
import { clamp, ewma, mean, quantile } from "@/lib/engine/math";
import { impliedTeamTotal } from "@/lib/engine/odds";
import { MODEL_PARAMS } from "@/lib/engine/player-forecast";
import { scoreGame, type GameResult, type ScoringFormat } from "./formats";

// ---------------------------------------------------------------- parameters
export interface FantasyParams {
  halfLife: number;
  wRecent: number;
  wSeason: number;
  shrinkK: number;
  /** Elasticity of fantasy points to the opponent's defense-vs-position index. */
  dvp: number;
  /** Games of the opponent's history used for defense vs position, and the shrinkage toward league average. */
  dvpWindow: number;
  dvpK: number;
  /** Elasticity of fantasy points to (expected team score ÷ usual team score). */
  env: number;
  /** Multiplier on the second night of a back-to-back. */
  b2b: number;
  minutes: number;
}

/**
 * Tuned on the walk-forward backtest of real games (scripts/tune-fantasy.ts): settings chosen on
 * the older 70% of games and checked on the most recent 30%. Held-out results (Nov 2026, default
 * format; average miss in fantasy points vs using the season average):
 *   NFL 4.67 vs 4.88 · NBA 7.38 vs 7.47 · NHL 4.85 vs 4.92 · soccer 2.89 vs 3.17.
 * NHL keeps its starting settings: the tuned ones did slightly worse on the held-out games.
 * MLB (off-season) uses general settings until there are games to check them on.
 */
export const FANTASY_PARAMS: Record<SportId, FantasyParams> = {
  nfl: { halfLife: 20, wRecent: 0.8, wSeason: 0.2, shrinkK: 1, dvp: 0.5, dvpWindow: 6, dvpK: 2, env: 0.4, b2b: 1, minutes: 0.2 },
  nba: { halfLife: 20, wRecent: 0.2, wSeason: 0.8, shrinkK: 0, dvp: 0.25, dvpWindow: 6, dvpK: 10, env: 0.6, b2b: 1, minutes: 0.4 },
  nhl: { halfLife: 14, wRecent: 0.4, wSeason: 0.6, shrinkK: 3, dvp: 0.4, dvpWindow: 15, dvpK: 6, env: 0.8, b2b: 0.98, minutes: 0.6 },
  mlb: { halfLife: 14, wRecent: 0.4, wSeason: 0.6, shrinkK: 3, dvp: 0.4, dvpWindow: 15, dvpK: 6, env: 0.6, b2b: 1, minutes: 0.4 },
  soccer: { halfLife: 20, wRecent: 0.8, wSeason: 0.2, shrinkK: 5, dvp: 0.4, dvpWindow: 10, dvpK: 4, env: 0.4, b2b: 1, minutes: 0.6 },
};

// ---------------------------------------------------------------- fantasy-point history
export interface FpRow {
  playerId: string;
  teamId: string;
  opponentId: string;
  gameId: string;
  date: string;
  season: string;
  home: boolean;
  group: string;
  fp: number;
  minutes: number;
}

export interface FantasyData {
  sport: SportId;
  format: ScoringFormat;
  rows: FpRow[];
  byPlayer: Map<string, FpRow[]>;
  games: Game[];
  gameById: Map<string, Game>;
  teamLogs: Map<string, TeamGameLog[]>;
  /** Per defending team: fantasy points allowed per game, by position group (oldest first). */
  allowed: Map<string, { date: string; gameId: string; byGroup: Record<string, number> }[]>;
  /** Per team: dates of completed and scheduled games (for rest days). */
  schedule: Map<string, string[]>;
}

export const dstId = (teamId: string) => `${teamId}-dst`;
export const isDst = (id: string) => id.endsWith("-dst");

const dataCache = new Map<string, Promise<FantasyData>>();

/** Fantasy-point history for every player (and NFL team defense) in a sport, in one format. */
export function loadFantasyData(sport: SportId, format: ScoringFormat): Promise<FantasyData> {
  const key = `${sport}:${format.id}`;
  let p = dataCache.get(key);
  if (!p) {
    p = buildData(sport, format);
    dataCache.set(key, p);
    p.catch(() => dataCache.delete(key));
  }
  return p;
}
/** Forget cached histories (after the stats refresh). */
export function clearFantasyCache() {
  dataCache.clear();
}

async function buildData(sport: SportId, format: ScoringFormat): Promise<FantasyData> {
  const prov = getProvider();
  const [players, games, teamLogsAll] = await Promise.all([prov.listPlayers({ sport }), prov.listGames({ sport }), prov.getTeamLogs({ sport })]);
  const gameById = new Map(games.map((g) => [g.id, g]));
  const result = (l: { gameId: string; home: boolean }): GameResult | null => {
    const g = gameById.get(l.gameId);
    if (!g || g.homeScore == null || g.awayScore == null) return null;
    const f = l.home ? g.homeScore : g.awayScore;
    const a = l.home ? g.awayScore : g.homeScore;
    return { scoreFor: f, scoreAgainst: a, won: f > a };
  };
  const rows: FpRow[] = [];
  const groups = new Set(format.groups);
  const logsAll = await Promise.all(players.filter((p) => groups.has(p.positionGroup)).map(async (p) => [p, await prov.getPlayerLogs(p.id)] as const));
  for (const [p, logs] of logsAll)
    for (const l of logs) {
      const fp = scoreGame(format, p.positionGroup, l.stats, result(l), l.minutes);
      if (fp == null) continue;
      rows.push(rowOf(p.id, p.positionGroup, l, fp));
    }
  const teamLogs = new Map<string, TeamGameLog[]>();
  for (const l of teamLogsAll) (teamLogs.get(l.teamId) ?? teamLogs.set(l.teamId, []).get(l.teamId)!).push(l);
  if (groups.has("DST"))
    for (const l of teamLogsAll) {
      const stats = dstStats(l);
      const fp = scoreGame(format, "DST", stats, { scoreFor: l.scoreFor, scoreAgainst: l.scoreAgainst, won: l.result === "W" }, 60);
      rows.push({ playerId: dstId(l.teamId), teamId: l.teamId, opponentId: l.opponentId, gameId: l.gameId, date: l.date, season: l.season, home: l.home, group: "DST", fp: fp ?? 0, minutes: 60 });
    }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byPlayer = new Map<string, FpRow[]>();
  for (const r of rows) (byPlayer.get(r.playerId) ?? byPlayer.set(r.playerId, []).get(r.playerId)!).push(r);

  // what each defense allowed, per game and position group
  const perGame = new Map<string, { team: string; date: string; gameId: string; byGroup: Record<string, number> }>();
  for (const r of rows) {
    const key = `${r.gameId}|${r.opponentId}`;
    const e = perGame.get(key) ?? { team: r.opponentId, date: r.date, gameId: r.gameId, byGroup: {} };
    e.byGroup[r.group] = (e.byGroup[r.group] ?? 0) + r.fp;
    perGame.set(key, e);
  }
  const allowed = new Map<string, { date: string; gameId: string; byGroup: Record<string, number> }[]>();
  for (const e of perGame.values()) (allowed.get(e.team) ?? allowed.set(e.team, []).get(e.team)!).push(e);
  for (const xs of allowed.values()) xs.sort((a, b) => a.date.localeCompare(b.date));

  const schedule = new Map<string, string[]>();
  for (const g of games)
    for (const t of [g.homeTeamId, g.awayTeamId]) (schedule.get(t) ?? schedule.set(t, []).get(t)!).push(g.date);
  for (const xs of schedule.values()) xs.sort();
  return { sport, format, rows, byPlayer, games, gameById, teamLogs, allowed, schedule };
}

function rowOf(playerId: string, group: string, l: PlayerGameLog, fp: number): FpRow {
  return { playerId, teamId: l.teamId, opponentId: l.opponentId, gameId: l.gameId, date: l.date, season: l.season, home: l.home, group, fp, minutes: l.minutes };
}

/** Team-defense box stats in fantasy terms (from the team's game log). */
export function dstStats(l: TeamGameLog): Record<string, number> {
  return { sacks: l.allowed.sacksTaken ?? 0, takeaways: l.allowed.turnovers ?? 0, defTd: l.box.defTd ?? 0, pointsAllowed: l.scoreAgainst };
}

// ---------------------------------------------------------------- defense vs position
export interface DvpEntry {
  /** Fantasy points the defense allows per game to this position (raw, recent window). */
  allowed: number;
  league: number;
  /** Shrunken allowed ÷ league average (> 1 = generous defense). */
  index: number;
  /** 1 = allows the most (best matchup) … of = allows the least. */
  rankEasiest: number;
  of: number;
  games: number;
}

const dvpCache = new Map<string, Map<string, Map<string, DvpEntry>>>();

/** Defense-vs-position table as of a date (only games before it). team → group → entry. */
export function dvpTable(data: FantasyData, before: string, params: FantasyParams): Map<string, Map<string, DvpEntry>> {
  const key = `${data.sport}:${data.format.id}:${before.slice(0, 10)}:${params.dvpWindow}:${params.dvpK}`;
  const hit = dvpCache.get(key);
  if (hit) return hit;
  const raw = new Map<string, { n: number; byGroup: Record<string, number> }>();
  for (const [team, xs] of data.allowed) {
    const prior = xs.filter((x) => x.date < before).slice(-params.dvpWindow);
    if (!prior.length) continue;
    const byGroup: Record<string, number> = {};
    for (const g of data.format.groups) byGroup[g] = mean(prior.map((x) => x.byGroup[g] ?? 0));
    raw.set(team, { n: prior.length, byGroup });
  }
  const out = new Map<string, Map<string, DvpEntry>>();
  for (const g of data.format.groups) {
    const vals = [...raw.values()].map((x) => x.byGroup[g]);
    const league = vals.length ? mean(vals) : 0;
    const sorted = [...raw.entries()].map(([t, x]) => [t, x.byGroup[g]] as const).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([team, v], i) => {
      const n = raw.get(team)!.n;
      const shrunk = (n * v + params.dvpK * league) / (n + params.dvpK);
      const e: DvpEntry = { allowed: v, league, index: league > 0 ? shrunk / league : 1, rankEasiest: i + 1, of: sorted.length, games: n };
      (out.get(team) ?? out.set(team, new Map()).get(team)!).set(g, e);
    });
  }
  dvpCache.set(key, out);
  if (dvpCache.size > 600) dvpCache.delete(dvpCache.keys().next().value!);
  return out;
}

// ---------------------------------------------------------------- team scoring environment
export interface TeamEnv {
  /** Points/goals/runs the team is expected to score in this game. */
  expected: number;
  /** What the team has scored per game recently. */
  usual: number;
  source: "market" | "model";
  /** Opponent's expected score (game script). */
  opponentExpected: number | null;
}

/** Expected team score for a game: market implied total when the game has a line, else the team model. */
export function teamEnv(data: FantasyData, game: Game, teamId: string): TeamEnv | null {
  const oppId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
  const recent = (t: string) => (data.teamLogs.get(t) ?? []).filter((l) => l.date < game.date).slice(-20);
  const mine = recent(teamId);
  const theirs = recent(oppId);
  if (mine.length < 3) return null;
  const usual = mean(mine.map((l) => l.scoreFor));
  const market = impliedTeamTotal(game, teamId);
  const oppMarket = impliedTeamTotal(game, oppId);
  if (market != null) return { expected: market, usual, source: "market", opponentExpected: oppMarket };
  // model: league average × own attack × opponent's defence (both shrunk), with a home edge
  const L = leagueScore(data, game.date);
  if (!(L > 0) || theirs.length < 3) return { expected: usual, usual, source: "model", opponentExpected: null };
  const shrink = (v: number, n: number) => (n * v + 8 * L) / (n + 8);
  const off = shrink(usual, mine.length) / L;
  const def = shrink(mean(theirs.map((l) => l.scoreAgainst)), theirs.length) / L;
  const oppOff = shrink(mean(theirs.map((l) => l.scoreFor)), theirs.length) / L;
  const myDef = shrink(mean(mine.map((l) => l.scoreAgainst)), mine.length) / L;
  const home = game.homeTeamId === teamId;
  const edge = 1.02;
  return { expected: L * off * def * (home ? edge : 1 / edge), usual, source: "model", opponentExpected: L * oppOff * myDef * (home ? 1 / edge : edge) };
}

const leagueCache = new WeakMap<FantasyData, Map<string, number>>();
/** League-average team score over roughly the last 20 games per team before a date. */
function leagueScore(data: FantasyData, before: string): number {
  const c = leagueCache.get(data) ?? leagueCache.set(data, new Map()).get(data)!;
  const key = before.slice(0, 10);
  const hit = c.get(key);
  if (hit != null) return hit;
  const vals: number[] = [];
  for (const xs of data.teamLogs.values()) for (const l of xs.filter((x) => x.date < before).slice(-20)) vals.push(l.scoreFor);
  const v = vals.length ? mean(vals) : NaN;
  c.set(key, v);
  return v;
}

/** Days since the team's previous game (null if unknown). */
export function restDays(data: FantasyData, teamId: string, date: string): number | null {
  const xs = data.schedule.get(teamId) ?? [];
  let prev: string | null = null;
  for (const d of xs) {
    if (d >= date) break;
    prev = d;
  }
  return prev ? (Date.parse(date) - Date.parse(prev)) / 86_400_000 : null;
}

// ---------------------------------------------------------------- weather (NFL outdoor games)
/**
 * Research-based weather effects (not fitted to this app's data — historical game-time weather
 * isn't in the feed). Strong wind cuts passing efficiency and field-goal accuracy; rain/snow and
 * hard cold lower passing a little; defenses and runners benefit slightly. When the game has a
 * betting line, the market total already reflects the forecast, so only half is applied.
 */
export function weatherEffect(group: string, w: GameWeather | null | undefined, indoor: boolean | undefined, halve: boolean): { mult: number; notes: string[] } {
  if (!w || indoor) return { mult: 1, notes: [] };
  const notes: string[] = [];
  const wind = w.windMph ?? 0;
  const over = Math.max(0, wind - 10);
  const cond = (w.condition ?? "").toLowerCase();
  const snow = /snow|flurr|sleet/.test(cond);
  const wet = snow || /rain|shower|storm|drizzle/.test(cond) || (w.precipChance ?? 0) >= 60;
  const cold = w.temperatureF != null && w.temperatureF < 25;
  const passer = group === "QB" || group === "WR" || group === "TE";
  let m = 1;
  if (passer) m *= 1 - 0.008 * over;
  if (group === "K") m *= 1 - 0.012 * over;
  if (group === "RB") m *= 1 + 0.002 * over;
  if (group === "DST") m *= 1 + 0.006 * over;
  if (over > 0) notes.push(`Wind ${wind} mph`);
  if (wet) {
    if (passer) m *= snow ? 0.95 : 0.97;
    if (group === "K") m *= 0.97;
    if (group === "RB") m *= 1.01;
    if (group === "DST") m *= 1.03;
    notes.push(snow ? "snow" : "rain likely");
  }
  if (cold) {
    if (passer) m *= 0.97;
    if (group === "K") m *= 0.96;
    notes.push(`${w.temperatureF}°F`);
  }
  if (halve) m = 1 + (m - 1) / 2;
  return { mult: clamp(m, 0.8, 1.08), notes };
}

// ---------------------------------------------------------------- projection
export interface FantasyComponent {
  key: "baseline" | "role" | "matchup" | "environment" | "rest" | "weather" | "health" | "teammates";
  label: string;
  effect: number;
  detail: string;
}

export interface FantasyProjection {
  points: number;
  floor: number;
  ceiling: number;
  components: FantasyComponent[];
  games: number;
  seasonAvg: number | null;
  last5Avg: number | null;
  recent: { date: string; fp: number; opponentId: string }[];
}

export interface ProjectInput {
  data: FantasyData;
  params: FantasyParams;
  playerId: string;
  group: string;
  teamId: string;
  game: Game;
  /** Rows strictly before the game (oldest first). */
  history: FpRow[];
  injury?: Injury | null;
  teammatesShare?: number | null;
  teammatesNames?: string[];
  /** Position average, the shrinkage target. */
  prior: number;
}

const fmt1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const pct = (m: number) => `${m >= 1 ? "+" : ""}${((m - 1) * 100).toFixed(1)}%`;

export function projectFantasy(inp: ProjectInput): FantasyProjection {
  const { data, params: P, history, game } = inp;
  const vals = history.map((r) => r.fp);
  const n = vals.length;
  const season = n ? history[n - 1].season : null;
  const seasonVals = history.filter((r) => r.season === season).map((r) => r.fp);
  const comps: FantasyComponent[] = [];

  // baseline
  const rec = n ? ewma(vals.slice(-30), P.halfLife) : NaN;
  const sea = seasonVals.length ? mean(seasonVals) : NaN;
  const parts: [number, number][] = [];
  if (Number.isFinite(rec)) parts.push([rec, P.wRecent]);
  if (Number.isFinite(sea)) parts.push([sea, P.wSeason * Math.min(1, seasonVals.length / 6)]);
  let base = parts.length ? parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0) : inp.prior;
  base = (n * base + P.shrinkK * inp.prior) / (n + P.shrinkK);
  comps.push({ key: "baseline", label: "Recent form & season", effect: 1, detail: `Recent form ${fmt1(rec)}, season ${fmt1(sea)} over ${seasonVals.length} games; position average ${fmt1(inp.prior)}.` });

  // role / playing time
  let role = 1;
  const mins = history.map((r) => r.minutes);
  if (!isDst(inp.playerId) && mins.length >= 6) {
    const recentMin = mean(mins.slice(-3));
    const ref = ewma(mins.slice(-20), 8);
    if (ref > 0) role = clamp(1 + P.minutes * (recentMin / ref - 1), 0.75, 1.3);
  }
  comps.push({ key: "role", label: "Role / playing time", effect: role, detail: role === 1 ? "Steady role." : `Playing time over the last 3 games is ${role > 1 ? "up" : "down"} (${pct(role)}).` });

  // matchup: defense vs position
  const oppId = game.homeTeamId === inp.teamId ? game.awayTeamId : game.homeTeamId;
  const dvp = dvpTable(data, game.date, P).get(oppId)?.get(inp.group) ?? null;
  const matchup = dvp ? clamp(Math.pow(dvp.index, P.dvp), 0.8, 1.25) : 1;
  comps.push({
    key: "matchup",
    label: "Matchup (defense vs position)",
    effect: matchup,
    detail: dvp ? `Opponent allows ${fmt1(dvp.allowed)} pts/game to ${inp.group} (league ${fmt1(dvp.league)}), ${ordinal(dvp.rankEasiest)} most of ${dvp.of}.` : "No defensive history yet.",
  });

  // game environment
  const env = teamEnv(data, game, inp.teamId);
  const envM = env && env.usual > 0 ? clamp(Math.pow(env.expected / env.usual, P.env), 0.75, 1.3) : 1;
  comps.push({
    key: "environment",
    label: "Game environment",
    effect: envM,
    detail: env
      ? `${env.source === "market" ? "Betting-market implied" : "Model"} team total ${fmt1(env.expected)} vs usual ${fmt1(env.usual)}.`
      : "No team scoring history yet.",
  });

  // rest
  const rd = restDays(data, inp.teamId, game.date);
  const restM = rd != null && rd < 1.6 ? P.b2b : 1;
  if (P.b2b !== 1) comps.push({ key: "rest", label: "Rest", effect: restM, detail: rd == null ? "Unknown." : rd < 1.6 ? "Second night of a back-to-back." : `${Math.round(rd)} days since last game.` });

  // weather
  if (data.sport === "nfl") {
    const w = weatherEffect(inp.group, game.weather, game.indoor, env?.source === "market");
    comps.push({
      key: "weather",
      label: "Weather",
      effect: w.mult,
      detail: game.indoor ? "Indoors." : game.weather ? `${weatherText(game.weather)}${w.notes.length && w.mult !== 1 ? ` — ${pct(w.mult)}` : ""}.` : "Forecast not available yet.",
    });
  }

  // health
  let health = 1;
  const st = inp.injury?.status;
  if (st) health = st === "out" ? 0 : st === "doubtful" ? 0.5 : st === "questionable" ? 0.9 : st === "day-to-day" ? 0.95 : 1;
  comps.push({ key: "health", label: "Health", effect: health, detail: inp.injury ? `${st}: ${inp.injury.description}` : "No injury listed." });

  // teammates out (only where the backtest supports it, as in the prop model)
  let mates = 1;
  const share = inp.teammatesShare ?? 0;
  if (share > 0) {
    mates = clamp(1 + (MODEL_PARAMS.teammateBoost[data.sport] ?? 0) * (share / (1 - share)), 1, 1.35);
    comps.push({ key: "teammates", label: "Teammates out", effect: mates, detail: `${(inp.teammatesNames ?? []).slice(0, 3).join(", ")} out — about ${Math.round(share * 100)}% of team scoring.` });
  }

  const points = Math.max(0, base) * role * matchup * envM * restM * (comps.find((c) => c.key === "weather")?.effect ?? 1) * health * mates;

  // floor/ceiling: the player's own spread of outcomes around his average, blended with a typical spread
  const last = vals.slice(-20);
  const m = mean(last);
  const own = last.length >= 6 && m > 0 ? [quantile(last, 0.1) / m, quantile(last, 0.9) / m] : null;
  const typical: [number, number] = data.sport === "nfl" ? [0.35, 1.7] : data.sport === "nba" ? [0.6, 1.4] : [0.15, 2.0];
  const lo = own ? (own[0] + typical[0]) / 2 : typical[0];
  const hi = own ? (own[1] + typical[1]) / 2 : typical[1];
  return {
    points,
    floor: points * Math.max(0, lo),
    ceiling: points * Math.max(1, hi),
    components: comps,
    games: n,
    seasonAvg: seasonVals.length ? sea : null,
    last5Avg: n ? mean(vals.slice(-5)) : null,
    recent: history.slice(-10).map((r) => ({ date: r.date, fp: r.fp, opponentId: r.opponentId })),
  };
}

export function weatherText(w: GameWeather) {
  const bits = [w.temperatureF != null ? `${Math.round(w.temperatureF)}°F` : null, w.condition || null, w.windMph != null ? `wind ${w.windMph} mph` : null, w.precipChance != null && w.precipChance >= 30 ? `${w.precipChance}% precip.` : null];
  return bits.filter(Boolean).join(", ");
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Average fantasy points per game for a position over rows before a date (the shrinkage prior). */
export function positionPrior(data: FantasyData, group: string, before: string): number {
  const key = `${group}|${before.slice(0, 10)}`;
  const c = priorCache.get(data) ?? priorCache.set(data, new Map()).get(data)!;
  const hit = c.get(key);
  if (hit != null) return hit;
  // regulars only: players' per-game means, among those with 3+ games (bench cameos would drag it down)
  const per = new Map<string, number[]>();
  for (const r of data.rows) {
    if (r.date >= before) break;
    if (r.group !== group) continue;
    (per.get(r.playerId) ?? per.set(r.playerId, []).get(r.playerId)!).push(r.fp);
  }
  const means = [...per.values()].filter((v) => v.length >= 3).map((v) => mean(v.slice(-15)));
  const v = means.length ? quantile(means, 0.5) : 0;
  c.set(key, v);
  return v;
}
const priorCache = new WeakMap<FantasyData, Map<string, number>>();

export type { Player };
