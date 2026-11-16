import { getProvider } from "@/lib/data";
import { SPORTS, formatStat, type TeamMetricDef } from "@/lib/sports";
import type { Game, SportId, Team, TeamGameLog } from "@/lib/types";
import { getLeagueContext } from "./context";
import { clamp, mean, normCdf, poissonPmf } from "./math";
import { CURRENT_MODEL_VERSION } from "./model";

// ---------------- team profiles ----------------
export interface MetricValue {
  def: TeamMetricDef;
  value: number | null;
  rank: number | null; // 1 = best
  of: number;
  percentile: number | null; // 100 = best
  leagueAvg: number | null;
}

export interface TeamProfile {
  team: Team;
  games: number;
  record: { w: number; l: number; d: number };
  last10: { w: number; l: number; d: number };
  scoreFor: number | null;
  scoreAgainst: number | null;
  offense: MetricValue[];
  defense: MetricValue[];
  homeRecord: { w: number; l: number; d: number };
  awayRecord: { w: number; l: number; d: number };
  recent: TeamGameLog[];
}

const recordOf = (logs: TeamGameLog[]) => ({
  w: logs.filter((l) => l.result === "W").length,
  l: logs.filter((l) => l.result === "L").length,
  d: logs.filter((l) => l.result === "D").length,
});

const profileCache = new Map<string, { at: number; data: Map<string, TeamProfile> }>();

/** Season-to-date team profiles with league ranks for every offensive & defensive metric. */
export async function getTeamProfiles(sport: SportId, opts: { from?: string; to?: string } = {}): Promise<Map<string, TeamProfile>> {
  const p = getProvider();
  const key = `${sport}:${opts.from ?? ""}:${opts.to ?? ""}`;
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const teams = await p.listTeams(sport);
  const all = await p.getTeamLogs({ sport });
  const latestSeason = all.length ? all[all.length - 1].season : null;
  void latestSeason;
  // "season to date"; early in a season (or for synced windows) fall back to the most recent 20 games per team
  const seasonGames = (tid: string) => all.filter((l) => l.teamId === tid && l.season === latestSeason).length;
  const shortSeason = teams.some((t) => seasonGames(t.id) < 8);
  const recentIds = new Set(teams.flatMap((t) => all.filter((l) => l.teamId === t.id).slice(-20).map((l) => l.gameId + t.id)));
  const inWindow = all.filter((l) =>
    opts.from || opts.to
      ? (!opts.from || l.date >= opts.from) && (!opts.to || l.date < opts.to)
      : shortSeason
        ? recentIds.has(l.gameId + l.teamId)
        : l.season === latestSeason,
  );
  const sdef = SPORTS[sport];
  const raw = new Map<string, { logs: TeamGameLog[]; vals: Record<string, number | null> }>();
  for (const t of teams) {
    const logs = inWindow.filter((l) => l.teamId === t.id);
    const vals: Record<string, number | null> = {};
    for (const m of sdef.teamMetrics) {
      const v = logs.length ? m.compute(logs) : null;
      vals[m.key] = v != null && Number.isFinite(v) ? v : null;
    }
    raw.set(t.id, { logs, vals });
  }
  // metrics the data source cannot supply for any team are omitted rather than shown empty
  const available = new Set(sdef.teamMetrics.filter((m) => [...raw.values()].some((x) => x.vals[m.key] != null)).map((m) => m.key));
  const out = new Map<string, TeamProfile>();
  for (const t of teams) {
    const r = raw.get(t.id)!;
    const mv = (m: TeamMetricDef): MetricValue => {
      const values = [...raw.values()].map((x) => x.vals[m.key]).filter((v): v is number => v != null);
      const v = r.vals[m.key];
      if (v == null) return { def: m, value: null, rank: null, of: values.length, percentile: null, leagueAvg: values.length ? mean(values) : null };
      const better = values.filter((x) => (m.higherIsBetter ? x > v : x < v)).length;
      const rank = better + 1;
      return {
        def: m,
        value: v,
        rank,
        of: values.length,
        percentile: values.length > 1 ? Math.round(((values.length - rank) / (values.length - 1)) * 100) : 50,
        leagueAvg: mean(values),
      };
    };
    const logs = r.logs;
    out.set(t.id, {
      team: t,
      games: logs.length,
      record: recordOf(logs),
      last10: recordOf(logs.slice(-10)),
      scoreFor: logs.length ? mean(logs.map((l) => l.scoreFor)) : null,
      scoreAgainst: logs.length ? mean(logs.map((l) => l.scoreAgainst)) : null,
      offense: sdef.teamMetrics.filter((m) => m.side === "offense" && available.has(m.key)).map(mv),
      defense: sdef.teamMetrics.filter((m) => m.side === "defense" && available.has(m.key)).map(mv),
      homeRecord: recordOf(logs.filter((l) => l.home)),
      awayRecord: recordOf(logs.filter((l) => !l.home)),
      recent: logs.slice(-10),
    });
  }
  profileCache.set(key, { at: Date.now(), data: out });
  return out;
}

/** Plain-language strengths & weaknesses derived from verified metric ranks. */
export function strengthsAndWeaknesses(p: TeamProfile) {
  const all = [...p.offense, ...p.defense].filter((m) => m.percentile != null);
  const strengths = all.filter((m) => m.percentile! >= 70).sort((a, b) => b.percentile! - a.percentile!);
  const weaknesses = all.filter((m) => m.percentile! <= 30).sort((a, b) => a.percentile! - b.percentile!);
  const line = (m: MetricValue) =>
    `${m.def.label}: ${formatStat(m.value, m.def.format)} (rank ${m.rank} of ${m.of}; league avg ${formatStat(m.leagueAvg, m.def.format)})`;
  return { strengths: strengths.slice(0, 5).map((m) => ({ metric: m, text: line(m) })), weaknesses: weaknesses.slice(0, 5).map((m) => ({ metric: m, text: line(m) })) };
}

// ---------------- matchup (offense vs defense) ----------------
const PAIRS: Record<SportId, [string, string][]> = {
  nba: [["ppg", "papg"], ["offRtg", "defRtg"], ["fg3Pct", "opp3Pct"], ["fgPct", "oppFgPct"], ["apg", "aapg"], ["tovRate", "forcedTov"]],
  nfl: [["ppg", "papg"], ["passYpg", "passYdsAllowed"], ["rushYpg", "rushYdsAllowed"], ["rzPct", "rzDef"], ["thirdPct", "thirdDef"], ["explosive", "pressure"]],
  mlb: [["rpg", "rapg"], ["avg", "whip"], ["hrpg", "hrAllowed"], ["kpg", "staffK"], ["obp", "era"]],
  nhl: [["gf", "ga"], ["sf", "sa"], ["pp", "pk"], ["shPct", "svPct"]],
  soccer: [["gf", "ga"], ["xgf", "xga"], ["shf", "sha"], ["sotf", "cs"]],
};

export interface MatchupEdge {
  offense: MetricValue;
  defense: MetricValue;
  /** Positive = edge for the offense, negative = edge for the defense (percentile points). */
  edge: number;
  verdict: "offense" | "defense" | "even";
  text: string;
}

export function offenseVsDefense(sport: SportId, off: TeamProfile, def: TeamProfile): MatchupEdge[] {
  return PAIRS[sport]
    .map(([ok, dk]) => {
      const o = off.offense.find((m) => m.def.key === ok);
      const d = def.defense.find((m) => m.def.key === dk);
      if (!o || !d || o.percentile == null || d.percentile == null) return null;
      const edge = o.percentile - d.percentile;
      const verdict: MatchupEdge["verdict"] = edge >= 25 ? "offense" : edge <= -25 ? "defense" : "even";
      const text =
        verdict === "offense"
          ? `${off.team.abbreviation} ${o.def.label.toLowerCase()} (rank ${o.rank}) faces a ${def.team.abbreviation} unit ranked ${d.rank} in ${d.def.label.toLowerCase()} — edge ${off.team.abbreviation}.`
          : verdict === "defense"
            ? `${def.team.abbreviation} ${d.def.label.toLowerCase()} (rank ${d.rank}) is a strength against ${off.team.abbreviation}'s ${o.def.label.toLowerCase()} (rank ${o.rank}).`
            : `${o.def.label} (rank ${o.rank}) vs ${d.def.label.toLowerCase()} (rank ${d.rank}): no clear edge.`;
      return { offense: o, defense: d, edge, verdict, text };
    })
    .filter((x): x is MatchupEdge => !!x);
}

// ---------------- game forecast ----------------
export interface GameForecast {
  modelVersion: string;
  gameId: string;
  sport: SportId;
  homeTeamId: string;
  awayTeamId: string;
  homeExpected: number;
  awayExpected: number;
  pHomeWin: number;
  pAwayWin: number;
  pDraw: number;
  projectedTotal: number;
  totalThreshold: number;
  pTotalOver: number;
  confidence: "low" | "medium" | "high";
  notes: string[];
  sample: { homeGames: number; awayGames: number };
}

export async function forecastGame(game: Game): Promise<GameForecast> {
  const sdef = SPORTS[game.sport];
  const ctx = await getLeagueContext(game.sport, game.date);
  const h = ctx.teams.get(game.homeTeamId);
  const a = ctx.teams.get(game.awayTeamId);
  const L = ctx.leagueScore || 1;
  const shrink = (v: number | undefined, n: number) => (v == null || !Number.isFinite(v) ? L : (n * v + 8 * L) / (n + 8));
  const hOff = shrink(h?.scoreFor, h?.games ?? 0) / L;
  const hDef = shrink(h?.scoreAgainst, h?.games ?? 0) / L;
  const aOff = shrink(a?.scoreFor, a?.games ?? 0) / L;
  const aDef = shrink(a?.scoreAgainst, a?.games ?? 0) / L;
  const edge = Math.sqrt(clamp(ctx.homeEdge, 0.9, 1.15));
  const homeExpected = L * hOff * aDef * edge;
  const awayExpected = (L * aOff * hDef) / edge;

  let pHome: number;
  let pAway: number;
  let pDraw = 0;
  let pTotalOver: number;
  const projectedTotal = homeExpected + awayExpected;
  const totalThreshold = sdef.lowScoring ? Math.round(projectedTotal * 2) / 2 + (Number.isInteger(Math.round(projectedTotal * 2) / 2) ? 0.5 : 0) : Math.round(projectedTotal) + 0.5;
  if (sdef.lowScoring) {
    // independent Poisson goals/runs; MLB variance inflation approximated by a wider grid weighting
    const max = 25;
    let ph = 0, pa = 0, pd = 0, pov = 0;
    for (let i = 0; i <= max; i++)
      for (let j = 0; j <= max; j++) {
        const pr = poissonPmf(i, homeExpected) * poissonPmf(j, awayExpected);
        if (i > j) ph += pr;
        else if (j > i) pa += pr;
        else pd += pr;
        if (i + j > totalThreshold) pov += pr;
      }
    if (sdef.allowDraw) {
      pHome = ph; pAway = pa; pDraw = pd;
    } else {
      const share = ph / Math.max(1e-9, ph + pa);
      pHome = ph + pd * share; pAway = pa + pd * (1 - share);
    }
    pTotalOver = pov;
  } else {
    const margin = homeExpected - awayExpected;
    pHome = 1 - normCdf(0, margin, sdef.marginSd);
    pAway = 1 - pHome;
    pTotalOver = 1 - normCdf(totalThreshold, projectedTotal, sdef.marginSd * 1.1);
  }
  const minGames = Math.min(h?.games ?? 0, a?.games ?? 0);
  const notes: string[] = [];
  if (minGames < 8) notes.push(`Limited sample: one team has only ${minGames} completed games in the recent window.`);
  notes.push("Team forecasts use recent scoring for/against (last 20 games), shrunk toward league average, with a league-estimated home edge. Win/loss streaks are not used as inputs.");
  return {
    modelVersion: CURRENT_MODEL_VERSION,
    gameId: game.id,
    sport: game.sport,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeExpected,
    awayExpected,
    pHomeWin: pHome,
    pAwayWin: pAway,
    pDraw,
    projectedTotal,
    totalThreshold,
    pTotalOver,
    confidence: minGames >= 15 ? "medium" : "low",
    notes,
    sample: { homeGames: h?.games ?? 0, awayGames: a?.games ?? 0 },
  };
}

export async function headToHead(teamA: string, teamB: string, limit = 10) {
  const logs = await getProvider().getTeamLogs({ teamId: teamA });
  return logs.filter((l) => l.opponentId === teamB).slice(-limit).reverse();
}

// ---------------- team markets (moneyline / spread / total / draw) ----------------
export interface MarketResult {
  p: number; // probability the leg wins
  push: number; // probability of a push (refund)
  expected: { team: number; opponent: number; total: number };
  forecast: GameForecast;
}

/** Probability that a team leg wins, from the team model's expected scores. */
export async function teamMarketProbability(
  game: Game,
  leg: { kind: "moneyline" | "spread" | "total" | "draw"; teamId: string; line?: number; side?: "over" | "under" },
): Promise<MarketResult> {
  const gf = await forecastGame(game);
  const sdef = SPORTS[game.sport];
  const isHome = leg.teamId === game.homeTeamId;
  const mine = isHome ? gf.homeExpected : gf.awayExpected;
  const theirs = isHome ? gf.awayExpected : gf.homeExpected;
  const expected = { team: mine, opponent: theirs, total: mine + theirs };
  if (leg.kind === "moneyline") return { p: isHome ? gf.pHomeWin : gf.pAwayWin, push: 0, expected, forecast: gf };
  if (leg.kind === "draw") return { p: gf.pDraw, push: 0, expected, forecast: gf };
  const line = leg.line ?? 0;
  if (sdef.lowScoring) {
    let win = 0, push = 0;
    for (let i = 0; i <= 25; i++)
      for (let j = 0; j <= 25; j++) {
        const pr = poissonPmf(i, mine) * poissonPmf(j, theirs);
        const v = leg.kind === "spread" ? i - j + line : leg.side === "under" ? line - (i + j) : i + j - line;
        if (Math.abs(v) < 1e-9) push += pr;
        else if (v > 0) win += pr;
      }
    return { p: win, push, expected, forecast: gf };
  }
  // high-scoring sports: normal approximation with a continuity correction for whole-number lines
  const sd = leg.kind === "spread" ? sdef.marginSd : sdef.marginSd * 1.1;
  const mean = leg.kind === "spread" ? mine - theirs + line : leg.side === "under" ? line - (mine + theirs) : mine + theirs - line;
  const whole = Number.isInteger(line);
  const win = whole ? 1 - normCdf(0.5, mean, sd) : 1 - normCdf(0, mean, sd);
  const push = whole ? normCdf(0.5, mean, sd) - normCdf(-0.5, mean, sd) : 0;
  return { p: win, push, expected, forecast: gf };
}
