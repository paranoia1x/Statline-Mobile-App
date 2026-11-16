import { getProvider } from "@/lib/data";
import { SPORTS, aggregateStat, type StatDef } from "@/lib/sports";
import type { Player, PlayerGameLog, SportId, TeamGameLog } from "@/lib/types";
import { mean } from "./math";

/**
 * League context as of a point in time: league averages and each team's
 * recent production / allowance. Only games completed before `before` are
 * used, so historical forecasts never see the future.
 */
export interface TeamWindow {
  teamId: string;
  games: number;
  box: Record<string, number>;
  allowed: Record<string, number>;
  scoreFor: number;
  scoreAgainst: number;
  homeScoreFor: number | null;
  awayScoreFor: number | null;
}

export interface LeagueContext {
  sport: SportId;
  before: string;
  leagueBox: Record<string, number>;
  leagueScore: number;
  homeEdge: number; // ratio home score / away score league-wide
  teams: Map<string, TeamWindow>;
  /** Index > 1 means the opponent allows / produces more of the dimension than average. */
  dimIndex(teamId: string, dimId: string): { index: number; raw: number | null; league: number | null; games: number } | null;
}

const WINDOW = 20;
const cache = new Map<string, LeagueContext>();

function avgRecord(rows: Record<string, number>[]) {
  const out: Record<string, number> = {};
  if (!rows.length) return out;
  for (const k of Object.keys(rows[0])) out[k] = mean(rows.map((r) => r[k] ?? 0));
  return out;
}

export async function getLeagueContext(sport: SportId, before: string): Promise<LeagueContext> {
  const day = before.slice(0, 13); // hour granularity
  const key = `${sport}:${day}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const logs = await getProvider().getTeamLogs({ sport, before });
  return buildContext(sport, before, logs, key);
}

function buildContext(sport: SportId, before: string, logs: TeamGameLog[], key: string): LeagueContext {
  const byTeam = new Map<string, TeamGameLog[]>();
  for (const l of logs) (byTeam.get(l.teamId) ?? byTeam.set(l.teamId, []).get(l.teamId)!).push(l);
  const teams = new Map<string, TeamWindow>();
  for (const [tid, all] of byTeam) {
    const w = all.slice(-WINDOW);
    const home = w.filter((x) => x.home);
    const away = w.filter((x) => !x.home);
    teams.set(tid, {
      teamId: tid,
      games: w.length,
      box: avgRecord(w.map((x) => x.box)),
      allowed: avgRecord(w.map((x) => x.allowed)),
      scoreFor: mean(w.map((x) => x.scoreFor)),
      scoreAgainst: mean(w.map((x) => x.scoreAgainst)),
      homeScoreFor: home.length ? mean(home.map((x) => x.scoreFor)) : null,
      awayScoreFor: away.length ? mean(away.map((x) => x.scoreFor)) : null,
    });
  }
  const recent = logs.slice(-WINDOW * byTeam.size);
  const leagueBox = avgRecord(recent.map((x) => x.box));
  const homes = recent.filter((x) => x.home);
  const aways = recent.filter((x) => !x.home);
  const homeEdge = homes.length && aways.length ? mean(homes.map((x) => x.scoreFor)) / Math.max(0.01, mean(aways.map((x) => x.scoreFor))) : 1;
  const sdef = SPORTS[sport];
  const ctx: LeagueContext = {
    sport,
    before,
    leagueBox,
    leagueScore: recent.length ? mean(recent.map((x) => x.scoreFor)) : NaN,
    homeEdge: Number.isFinite(homeEdge) ? homeEdge : 1,
    teams,
    dimIndex(teamId, dimId) {
      const dim = sdef.dims.find((d) => d.id === dimId);
      const tw = teams.get(teamId);
      if (!dim || !tw || !tw.games) return null;
      const raw = (dim.source === "allowed" ? tw.allowed : tw.box)[dim.key];
      const league = leagueBox[dim.key];
      if (raw == null || !league) return null;
      // shrink toward league average for small samples
      const k = 6;
      const shrunk = (tw.games * raw + k * league) / (tw.games + k);
      return { index: shrunk / league, raw, league, games: tw.games };
    },
  };
  cache.set(key, ctx);
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  return ctx;
}

// ---------------- player summaries ----------------
export const currentSeasonOf = (logs: PlayerGameLog[]) => (logs.length ? logs[logs.length - 1].season : null);

export interface SplitRow {
  label: string;
  games: number;
  minutes: number | null;
  values: Record<string, number | null>;
}

export function computeSplits(player: Player, logs: PlayerGameLog[], stats: StatDef[], season?: string | null): SplitRow[] {
  const s = season ?? currentSeasonOf(logs);
  const seasonLogs = logs.filter((l) => l.season === s);
  const windows: [string, PlayerGameLog[]][] = [
    ["Last 5", logs.slice(-5)],
    ["Last 10", logs.slice(-10)],
    ["Last 20", logs.slice(-20)],
    [`Season ${s ?? ""}`.trim(), seasonLogs],
    ["Career (available)", logs],
    ["Home", seasonLogs.filter((l) => l.home)],
    ["Away", seasonLogs.filter((l) => !l.home)],
  ];
  void player;
  return windows.map(([label, ls]) => ({
    label,
    games: ls.length,
    minutes: ls.length ? mean(ls.map((l) => l.minutes)) : null,
    values: Object.fromEntries(stats.map((d) => [d.key, aggregateStat(d, ls)])),
  }));
}
