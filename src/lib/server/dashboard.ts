import { getProvider } from "@/lib/data";
import { getLeagueContext } from "@/lib/engine/context";
import { mean } from "@/lib/engine/math";
import { detectPlayerPatterns, type Pattern } from "@/lib/engine/patterns";
import { SPORTS, statDef, type StatDef } from "@/lib/sports";
import type { Game, Player, SportId } from "@/lib/types";
import { SPORT_IDS } from "@/lib/types";
import { playerVM, type PlayerVM } from "@/lib/view";
import { gameVM, injuryMap, teamMap } from "./lookups";

export function primaryStat(p: Player): StatDef | null {
  for (const k of SPORTS[p.sport].headline[p.positionGroup] ?? []) {
    const d = statDef(p.sport, k);
    if (d?.forecastable) return d;
  }
  return null;
}

export async function gamesBetween(sport: SportId | null, from: Date, to: Date) {
  const p = getProvider();
  return p.listGames({ sport: sport ?? undefined, from: from.toISOString(), to: to.toISOString() });
}

/** Key players for a team in a game card: starters, healthy first, by role. */
export async function keyPlayersFor(games: Game[]) {
  const p = getProvider();
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  const out = new Map<string, PlayerVM[]>();
  const tids = new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]));
  for (const tid of tids) {
    const roster = (await p.listPlayers({ teamId: tid })).filter((pl) => pl.role === "starter" && inj.get(pl.id)?.status !== "out");
    out.set(tid, roster.slice(0, 3).map((pl) => playerVM(pl, teams.get(tid), inj.get(pl.id))));
  }
  return out;
}

export interface FeaturedPlayer {
  player: PlayerVM;
  stat: StatDef;
  last10: number;
  season: number;
  delta: number; // relative to season
}

/** Players producing the most above their own season baseline in their primary stat. */
export async function featuredPlayers(sport: SportId | null, limit = 6): Promise<FeaturedPlayer[]> {
  const p = getProvider();
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  const players = await p.listPlayers({ sport: sport ?? undefined });
  const rows: FeaturedPlayer[] = [];
  for (const pl of players) {
    if (pl.role !== "starter") continue; // regulars only: tiny baselines produce misleading % jumps
    const stat = primaryStat(pl);
    if (!stat) continue;
    const logs = await p.getPlayerLogs(pl.id);
    if (logs.length < 15) continue;
    const season = logs[logs.length - 1].season;
    const sv = logs.filter((l) => l.season === season).map((l) => l.stats[stat.key]).filter((v): v is number => typeof v === "number");
    const l10 = logs.slice(-10).map((l) => l.stats[stat.key]).filter((v): v is number => typeof v === "number");
    if (sv.length < 5 || l10.length < 5) continue;
    const s = mean(sv);
    if (s <= 0) continue;
    rows.push({ player: playerVM(pl, teams.get(pl.teamId), inj.get(pl.id)), stat, last10: mean(l10), season: s, delta: mean(l10) / s - 1 });
  }
  // spread across sports when "all"
  rows.sort((a, b) => b.delta - a.delta);
  if (!sport) {
    const picked: FeaturedPlayer[] = [];
    for (const sid of SPORT_IDS) {
      const r = rows.find((x) => x.player.sport === sid);
      if (r) picked.push(r);
    }
    return [...picked, ...rows.filter((r) => !picked.includes(r))].slice(0, limit);
  }
  return rows.slice(0, limit);
}

export interface TrendingRow {
  player: PlayerVM;
  pattern: Pattern;
}

export async function trendingPerformances(sport: SportId | null, limit = 6): Promise<TrendingRow[]> {
  const p = getProvider();
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  const players = await p.listPlayers({ sport: sport ?? undefined });
  const rows: TrendingRow[] = [];
  for (const pl of players) {
    const logs = await p.getPlayerLogs(pl.id);
    if (pl.role === "reserve") continue;
    const pats = detectPlayerPatterns(pl, logs).filter((x) => x.kind === "form" || x.kind === "role");
    if (pats[0]) rows.push({ player: playerVM(pl, teams.get(pl.teamId), inj.get(pl.id)), pattern: pats[0] });
  }
  return rows.sort((a, b) => b.pattern.strength - a.pattern.strength).slice(0, limit);
}

export interface DefensiveMatchupRow {
  player: PlayerVM;
  opponent: ReturnType<typeof playerVM>["team"];
  game: ReturnType<typeof gameVM>;
  stat: StatDef;
  dimLabel: string;
  index: number; // >1 = opponent allows more
  seasonAvg: number | null;
}

/** Upcoming games where a starter's primary stat faces an unusually generous or stingy opponent. */
export async function interestingDefensiveMatchups(sport: SportId | null, now: Date, limit = 6): Promise<DefensiveMatchupRow[]> {
  const p = getProvider();
  const games = (await gamesBetween(sport, now, new Date(now.getTime() + 2.5 * 86_400_000))).filter((g) => g.status === "scheduled");
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  const rows: DefensiveMatchupRow[] = [];
  for (const g of games.slice(0, 24)) {
    const ctx = await getLeagueContext(g.sport, g.date);
    for (const [tid, oid] of [[g.homeTeamId, g.awayTeamId], [g.awayTeamId, g.homeTeamId]]) {
      const roster = (await p.listPlayers({ teamId: tid })).filter((pl) => pl.role === "starter" && inj.get(pl.id)?.status !== "out");
      for (const pl of roster) {
        const stat = primaryStat(pl);
        if (!stat?.dim) continue;
        const ix = ctx.dimIndex(oid, stat.dim);
        if (!ix) continue;
        const logs = (await p.getPlayerLogs(pl.id)).slice(-30);
        const vals = logs.map((l) => l.stats[stat.key]).filter((v): v is number => typeof v === "number");
        rows.push({
          player: playerVM(pl, teams.get(tid), inj.get(pl.id)),
          opponent: playerVM(pl, teams.get(oid)).team,
          game: gameVM(g, teams),
          stat,
          dimLabel: SPORTS[g.sport].dims.find((d) => d.id === stat.dim)!.label,
          index: ix.index,
          seasonAvg: vals.length ? mean(vals) : null,
        });
      }
    }
  }
  rows.sort((a, b) => Math.abs(b.index - 1) - Math.abs(a.index - 1));
  // diversity: at most one row per team-side of a game
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.game.id + r.player.teamId;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, limit);
}
