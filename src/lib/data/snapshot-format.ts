/**
 * Compact snapshot format published by the data job (scripts/build-data.ts) and read by the
 * app (SnapshotProvider). One file per sport. Game logs are packed as arrays that index into
 * the team/player/game lists, which keeps the download a fraction of the plain-JSON size.
 */
import type { Game, Injury, Player, PlayerGameLog, SportId, Team, TeamGameLog } from "@/lib/types";

export const SNAPSHOT_VERSION = 1;

type Num = number | null;
/** [playerIdx, gameIdx, home 1/0, started 1/0, minutes, ...stat values aligned with statKeys] */
export type PackedPlayerLog = Num[];
/** [teamIdx, gameIdx, home 1/0, scoreFor, scoreAgainst, ...box (teamStatKeys), ...allowed (teamStatKeys)] */
export type PackedTeamLog = Num[];

export interface SportLabels {
  playingTimeLabel?: string;
  playingTimeShort?: string;
  usageLabel?: string;
}

export interface SportSnapshot {
  v: number;
  sport: SportId;
  generatedAt: string;
  source: string;
  labels: SportLabels;
  unsupported: string[];
  teams: Team[];
  players: Player[];
  games: Game[];
  injuries: Injury[];
  statKeys: string[];
  logs: PackedPlayerLog[];
  teamStatKeys: string[];
  teamLogs: PackedTeamLog[];
  /** Verified image URLs only (ESPN CDN). Missing => placeholder. */
  images: { players: Record<string, string>; teams: Record<string, string> };
}

/** Index file: what's available and when it was built. */
export interface SnapshotMeta {
  v: number;
  generatedAt: string;
  sports: { sport: SportId; file: string; bytes: number; games: number; finals: number; players: number }[];
  files: { model: string; plays: string; fantasy?: string };
}

const r = (v: number) => Math.round(v * 100) / 100;

export function packLogs(players: Player[], games: Game[], logs: PlayerGameLog[]) {
  const pIdx = new Map(players.map((p, i) => [p.id, i]));
  const gIdx = new Map(games.map((g, i) => [g.id, i]));
  const keys = [...new Set(logs.flatMap((l) => Object.keys(l.stats)))].sort();
  const packed: PackedPlayerLog[] = [];
  for (const l of logs) {
    const pi = pIdx.get(l.playerId);
    const gi = gIdx.get(l.gameId);
    if (pi == null || gi == null) continue;
    packed.push([pi, gi, l.home ? 1 : 0, l.started ? 1 : 0, r(l.minutes), ...keys.map((k) => (typeof l.stats[k] === "number" ? r(l.stats[k]) : null))]);
  }
  return { statKeys: keys, logs: packed };
}

export function packTeamLogs(teams: Team[], games: Game[], logs: TeamGameLog[]) {
  const tIdx = new Map(teams.map((t, i) => [t.id, i]));
  const gIdx = new Map(games.map((g, i) => [g.id, i]));
  const keys = [...new Set(logs.flatMap((l) => [...Object.keys(l.box), ...Object.keys(l.allowed)]))].sort();
  const val = (o: Record<string, number>, k: string) => (typeof o[k] === "number" ? r(o[k]) : null);
  const packed: PackedTeamLog[] = [];
  for (const l of logs) {
    const ti = tIdx.get(l.teamId);
    const gi = gIdx.get(l.gameId);
    if (ti == null || gi == null) continue;
    packed.push([ti, gi, l.home ? 1 : 0, l.scoreFor, l.scoreAgainst, ...keys.map((k) => val(l.box, k)), ...keys.map((k) => val(l.allowed, k))]);
  }
  return { teamStatKeys: keys, teamLogs: packed };
}

const opp = (g: Game, home: boolean) => (home ? g.awayTeamId : g.homeTeamId);

export function unpackLogs(s: SportSnapshot): PlayerGameLog[] {
  const out: PlayerGameLog[] = [];
  for (const row of s.logs) {
    const p = s.players[row[0]!];
    const g = s.games[row[1]!];
    if (!p || !g) continue;
    const home = row[2] === 1;
    const stats: Record<string, number> = {};
    s.statKeys.forEach((k, i) => {
      const v = row[5 + i];
      if (v != null) stats[k] = v;
    });
    out.push({
      playerId: p.id, gameId: g.id, sport: s.sport, season: g.season, date: g.date,
      teamId: home ? g.homeTeamId : g.awayTeamId, opponentId: opp(g, home), home, started: row[3] === 1, minutes: row[4] ?? 0, stats,
    });
  }
  return out;
}

export function unpackTeamLogs(s: SportSnapshot): TeamGameLog[] {
  const out: TeamGameLog[] = [];
  const n = s.teamStatKeys.length;
  for (const row of s.teamLogs) {
    const t = s.teams[row[0]!];
    const g = s.games[row[1]!];
    if (!t || !g) continue;
    const home = row[2] === 1;
    const box: Record<string, number> = {};
    const allowed: Record<string, number> = {};
    s.teamStatKeys.forEach((k, i) => {
      const a = row[5 + i];
      const b = row[5 + n + i];
      if (a != null) box[k] = a;
      if (b != null) allowed[k] = b;
    });
    const sf = row[3] ?? 0;
    const sa = row[4] ?? 0;
    out.push({
      teamId: t.id, gameId: g.id, sport: s.sport, season: g.season, date: g.date, opponentId: opp(g, home), home,
      scoreFor: sf, scoreAgainst: sa, result: sf > sa ? "W" : sf < sa ? "L" : "D", box, allowed,
    });
  }
  return out;
}
