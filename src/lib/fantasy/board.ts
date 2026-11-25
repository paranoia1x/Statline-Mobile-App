/**
 * Fantasy board: projections for every relevant player on an upcoming slate (an NFL week, or a
 * day of games in other sports), ranked by position, with the matchup, team-offense and
 * opponent-defense ranks, game environment and weather that drive each number.
 */
import { getProvider } from "@/lib/data";
import { teamVM, playerVM, type PlayerVM, type TeamVM } from "@/lib/view";
import type { Game, GameWeather, Injury, Player, SportId, Team } from "@/lib/types";
import { clamp, ewma, mean } from "@/lib/engine/math";
import { impliedScores } from "@/lib/engine/odds";
import { teammatesOut } from "@/lib/engine/teammates";
import { formatsFor, getFormat, GROUP_LABELS, type ScoringFormat } from "./formats";
import {
  dvpTable, dstId, FANTASY_PARAMS, isDst, loadFantasyData, ordinal, positionPrior, projectFantasy, teamEnv,
  type DvpEntry, type FantasyComponent, type FantasyData, type FantasyProjection,
} from "./engine";

export interface TeamRank {
  offense: number | null;
  defense: number | null;
  of: number;
  scoreFor: number | null;
  scoreAgainst: number | null;
}

export interface SlateGame {
  id: string;
  date: string;
  home: TeamVM;
  away: TeamVM;
  venue: string;
  homeImplied: number | null;
  awayImplied: number | null;
  total: number | null;
  spread: number | null;
  weather: GameWeather | null;
  indoor: boolean | null;
  homeRank: TeamRank;
  awayRank: TeamRank;
}

export type Grade = "Great" | "Good" | "Neutral" | "Tough" | "Very tough";
export type Tier = "Start" | "Flex" | "Bench" | "Top" | "Solid" | "Fringe" | "Out";

export interface FantasyRow {
  id: string;
  player: PlayerVM;
  group: string;
  groupLabel: string;
  gameId: string;
  date: string;
  home: boolean;
  team: TeamVM;
  opponent: TeamVM;
  points: number;
  floor: number;
  ceiling: number;
  rank: number;
  of: number;
  tier: Tier;
  matchup: (DvpEntry & { grade: Grade }) | null;
  teamRank: TeamRank;
  opponentRank: TeamRank;
  implied: { team: number; opponent: number | null; usual: number; source: "market" | "model" } | null;
  components: FantasyComponent[];
  seasonAvg: number | null;
  last5Avg: number | null;
  recent: FantasyProjection["recent"];
  games: number;
  status: Injury["status"] | null;
  injuryNote: string | null;
}

export interface FantasyBoard {
  sport: SportId;
  format: { id: string; label: string; note: string };
  formats: { id: string; label: string; short: string }[];
  groups: { id: string; label: string }[];
  slates: { id: string; label: string; games: number }[];
  slate: string | null;
  games: SlateGame[];
  rows: FantasyRow[];
  generatedAt: string;
}

const DAY = 86_400_000;
/** Starters per position in a typical 12-team league (NFL tiers). */
const NFL_STARTERS: Record<string, [number, number]> = { QB: [12, 18], RB: [24, 36], WR: [30, 42], TE: [12, 18], K: [12, 14], DST: [12, 14] };

export function slateKey(sport: SportId, date: string) {
  if (sport === "nfl") return "week";
  return new Date(Date.parse(date) - 6 * 3600_000).toISOString().slice(0, 10);
}

function slateLabel(sport: SportId, key: string, now: Date) {
  if (sport === "nfl") return "This week";
  const today = new Date(now.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() - 6 * 3600_000 + DAY).toISOString().slice(0, 10);
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  return new Date(key + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Season-to-date offense (points for) and defense (points against) ranks, 1 = best. */
export function teamRanks(data: FantasyData, before: string): Map<string, TeamRank> {
  const per: { team: string; f: number; a: number }[] = [];
  for (const [team, logs] of data.teamLogs) {
    const prior = logs.filter((l) => l.date < before);
    if (!prior.length) continue;
    const season = prior[prior.length - 1].season;
    let xs = prior.filter((l) => l.season === season);
    if (xs.length < 4) xs = prior.slice(-12); // early season: lean on recent games
    per.push({ team, f: mean(xs.map((l) => l.scoreFor)), a: mean(xs.map((l) => l.scoreAgainst)) });
  }
  const off = [...per].sort((x, y) => y.f - x.f).map((x) => x.team);
  const def = [...per].sort((x, y) => x.a - y.a).map((x) => x.team);
  const out = new Map<string, TeamRank>();
  for (const x of per) out.set(x.team, { offense: off.indexOf(x.team) + 1, defense: def.indexOf(x.team) + 1, of: per.length, scoreFor: x.f, scoreAgainst: x.a });
  return out;
}

export function gradeOf(e: DvpEntry): Grade {
  const p = e.of > 1 ? (e.rankEasiest - 1) / (e.of - 1) : 0.5;
  return p < 0.2 ? "Great" : p < 0.4 ? "Good" : p < 0.6 ? "Neutral" : p < 0.8 ? "Tough" : "Very tough";
}

const noRank = (): TeamRank => ({ offense: null, defense: null, of: 0, scoreFor: null, scoreAgainst: null });

export async function getFantasyBoard(sport: SportId, formatId?: string | null, slateId?: string | null): Promise<FantasyBoard> {
  const prov = getProvider();
  const format = getFormat(formatId, sport);
  const params = FANTASY_PARAMS[sport];
  const now = prov.now();
  const [data, teams, players, injuries] = await Promise.all([
    loadFantasyData(sport, format),
    prov.listTeams(sport),
    prov.listPlayers({ sport }),
    prov.getInjuries(sport),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const inj = new Map(injuries.map((i) => [i.playerId, i]));

  // upcoming games (in progress counts until ~4h after the start)
  const horizon = sport === "nfl" ? 7.5 * DAY : 8 * DAY;
  const upcoming = data.games
    .filter((g) => g.status === "scheduled" && Date.parse(g.date) > now.getTime() - 4 * 3600_000 && Date.parse(g.date) < now.getTime() + horizon)
    .filter((g) => teamById.has(g.homeTeamId) && teamById.has(g.awayTeamId))
    .sort((a, b) => a.date.localeCompare(b.date));
  const slateMap = new Map<string, Game[]>();
  for (const g of upcoming) (slateMap.get(slateKey(sport, g.date)) ?? slateMap.set(slateKey(sport, g.date), []).get(slateKey(sport, g.date))!).push(g);
  const slates = [...slateMap.entries()].map(([id, gs]) => ({ id, label: slateLabel(sport, id, now), games: gs.length }));
  const slate = slateId && slateMap.has(slateId) ? slateId : slates[0]?.id ?? null;
  // one game per team (its first in the slate)
  const slateGames: Game[] = [];
  const seen = new Set<string>();
  for (const g of slate ? slateMap.get(slate)! : []) {
    if (seen.has(g.homeTeamId) || seen.has(g.awayTeamId)) continue;
    seen.add(g.homeTeamId);
    seen.add(g.awayTeamId);
    slateGames.push(g);
  }

  const ranks = teamRanks(data, now.toISOString());
  const rankOf = (t: string) => ranks.get(t) ?? noRank();
  const games: SlateGame[] = slateGames.map((g) => {
    const s = impliedScores(g, sport);
    return {
      id: g.id, date: g.date, venue: g.venue, home: teamVM(teamById.get(g.homeTeamId)!), away: teamVM(teamById.get(g.awayTeamId)!),
      homeImplied: s?.home ?? null, awayImplied: s?.away ?? null, total: g.odds?.total ?? null, spread: g.odds?.spread ?? null,
      weather: g.weather ?? null, indoor: g.indoor ?? null, homeRank: rankOf(g.homeTeamId), awayRank: rankOf(g.awayTeamId),
    };
  });

  const rows: FantasyRow[] = [];
  const groups = new Set(format.groups);
  const byTeam = new Map<string, Player[]>();
  for (const p of players) if (groups.has(p.positionGroup)) (byTeam.get(p.teamId) ?? byTeam.set(p.teamId, []).get(p.teamId)!).push(p);

  for (const g of slateGames) {
    for (const teamId of [g.homeTeamId, g.awayTeamId]) {
      const team = teamById.get(teamId)!;
      const oppId = teamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
      const opp = teamById.get(oppId)!;
      const recentTeamGames = (data.teamLogs.get(teamId) ?? []).filter((l) => l.date < g.date).slice(-4).map((l) => l.gameId);
      const candidates: { id: string; group: string; vm: PlayerVM; player: Player | null }[] = [];
      for (const p of byTeam.get(teamId) ?? []) {
        const hist = data.byPlayer.get(p.id) ?? [];
        // active contributors: played for this team in one of its last 4 games, or listed injured after doing so recently
        const active = hist.some((r) => r.teamId === teamId && recentTeamGames.includes(r.gameId));
        if (!active || hist.length < 2) continue;
        candidates.push({ id: p.id, group: p.positionGroup, vm: playerVM(p, team, inj.get(p.id)), player: p });
      }
      if (groups.has("DST") && (data.byPlayer.get(dstId(teamId))?.length ?? 0) >= 2)
        candidates.push({ id: dstId(teamId), group: "DST", vm: dstVM(team), player: null });

      for (const c of candidates) {
        const history = (data.byPlayer.get(c.id) ?? []).filter((r) => r.date < g.date);
        const injury = c.player ? inj.get(c.id) ?? null : null;
        let mates: { share: number; names: string[] } | null = null;
        if (c.player && sport === "nba" && !injury) {
          const t = await teammatesOut(c.player, "pts", g).catch(() => null);
          if (t) mates = { share: t.share, names: t.players.map((x) => x.name) };
        }
        const f = projectFantasy({
          data, params, playerId: c.id, group: c.group, teamId, game: g, history, injury,
          teammatesShare: mates?.share ?? null, teammatesNames: mates?.names, prior: positionPrior(data, c.group, g.date),
        });
        const dvp = dvpTable(data, g.date, params).get(oppId)?.get(c.group) ?? null;
        const env = teamEnv(data, g, teamId);
        rows.push({
          id: c.id, player: c.vm, group: c.group, groupLabel: GROUP_LABELS[c.group] ?? c.group, gameId: g.id, date: g.date, home: teamId === g.homeTeamId,
          team: teamVM(team), opponent: teamVM(opp), points: f.points, floor: f.floor, ceiling: f.ceiling, rank: 0, of: 0, tier: "Bench",
          matchup: dvp ? { ...dvp, grade: gradeOf(dvp) } : null, teamRank: rankOf(teamId), opponentRank: rankOf(oppId),
          implied: env ? { team: env.expected, opponent: env.opponentExpected, usual: env.usual, source: env.source } : null,
          components: f.components, seasonAvg: f.seasonAvg, last5Avg: f.last5Avg, recent: f.recent, games: f.games,
          status: injury?.status ?? null, injuryNote: injury ? injury.description : null,
        });
      }
    }
  }

  // positional ranks and tiers
  for (const grp of format.groups) {
    const xs = rows.filter((r) => r.group === grp).sort((a, b) => b.points - a.points);
    xs.forEach((r, i) => {
      r.rank = i + 1;
      r.of = xs.length;
      r.tier = tierOf(sport, grp, i + 1, xs.length, r.status);
    });
  }
  rows.sort((a, b) => b.points - a.points);
  return {
    sport,
    format: { id: format.id, label: format.label, note: format.note },
    formats: formatsFor(sport).map((f) => ({ id: f.id, label: f.label, short: f.short })),
    groups: format.groups.map((g) => ({ id: g, label: GROUP_LABELS[g] ?? g })),
    slates,
    slate,
    games,
    rows,
    generatedAt: now.toISOString(),
  };
}

function tierOf(sport: SportId, group: string, rank: number, of: number, status: Injury["status"] | null): Tier {
  if (status === "out") return "Out";
  if (sport === "nfl") {
    const [start, flex] = NFL_STARTERS[group] ?? [12, 18];
    return rank <= start ? "Start" : rank <= flex ? "Flex" : "Bench";
  }
  const p = rank / Math.max(1, of);
  return p <= 0.2 ? "Top" : p <= 0.5 ? "Solid" : "Fringe";
}

function dstVM(team: Team): PlayerVM {
  const t = teamVM(team);
  return {
    id: dstId(team.id), sport: team.sport, name: `${team.name} D/ST`, firstName: team.city, lastName: `${team.name} D/ST`, position: "D/ST",
    positionGroup: "DST", jersey: 0, teamId: team.id, imageUrl: t.logoUrl, team: t, injury: null,
  };
}

// ---------------------------------------------------------------- one player (player page / detail sheet)
export interface StatLineItem {
  key: string;
  label: string;
  value: number;
  pts: number;
}

/**
 * The projected box-score line behind a fantasy projection: each scored stat's recent rate,
 * scaled by the same adjustments as the fantasy total, with its fantasy-point contribution.
 */
export async function projectedStatLine(row: FantasyRow, formatId: string): Promise<StatLineItem[]> {
  if (isDst(row.id)) return [];
  const prov = getProvider();
  const format = getFormat(formatId, row.player.sport);
  const logs = (await prov.getPlayerLogs(row.id, { before: row.date })).slice(-20);
  if (!logs.length) return [];
  const params = FANTASY_PARAMS[row.player.sport];
  const scale = row.components.filter((c) => c.key !== "baseline").reduce((a, c) => a * c.effect, 1);
  const KEYS: Record<string, string[]> = {
    nfl: ["passYds", "passTd", "int", "carries", "rushYds", "rushTd", "targets", "rec", "recYds", "recTd", "fgm", "xpm"],
    nba: ["pts", "reb", "ast", "fg3m", "stl", "blk", "tov"],
    nhl: ["goals", "assists", "sog", "blk", "saves", "ga"],
    mlb: ["hits", "hr", "runs", "rbi", "bb", "outs", "k", "er"],
    soccer: ["goals", "assists", "shots", "sot", "saves"],
  };
  const labels: Record<string, string> = {
    passYds: "Pass yds", passTd: "Pass TD", int: "INT", carries: "Carries", rushYds: "Rush yds", rushTd: "Rush TD", targets: "Targets", rec: "Receptions",
    recYds: "Rec yds", recTd: "Rec TD", fgm: "FG made", xpm: "XP made", pts: "Points", reb: "Rebounds", ast: "Assists", fg3m: "3PM", stl: "Steals", blk: "Blocks",
    tov: "Turnovers", goals: "Goals", assists: "Assists", sog: "Shots on goal", saves: "Saves", ga: "Goals against", hits: "Hits", hr: "Home runs", runs: "Runs",
    rbi: "RBI", bb: "Walks", outs: "Outs", k: "Strikeouts", er: "Earned runs", shots: "Shots", sot: "Shots on target",
  };
  const rules = format.rules(row.group);
  const ptsPer = (key: string) => {
    // per-unit value of a stat in this format, found by scoring a line with one unit of it
    let total = 0;
    for (const r of rules) if (!r.bonus) total += r.pts * r.value({ [key]: 1 }, null, 60);
    return total;
  };
  const out: StatLineItem[] = [];
  for (const key of KEYS[row.player.sport] ?? []) {
    const vals = logs.map((l) => l.stats[key]).filter((v): v is number => typeof v === "number");
    if (vals.length < Math.min(3, logs.length) || !vals.some((v) => v !== 0)) continue;
    const v = ewma(vals, params.halfLife) * clamp(key === "int" || key === "tov" || key === "ga" || key === "er" ? 1 : scale, 0.5, 1.6);
    out.push({ key, label: labels[key] ?? key, value: v, pts: v * ptsPer(key) });
  }
  return out;
}

export async function getPlayerFantasy(playerId: string, formatId?: string | null): Promise<{ row: FantasyRow; board: FantasyBoard; line: StatLineItem[] } | null> {
  const prov = getProvider();
  const sport = playerId.split("-")[0] as SportId;
  const p = isDst(playerId) ? null : await prov.getPlayer(playerId);
  if (!isDst(playerId) && !p) return null;
  const teamId = p?.teamId ?? playerId.replace(/-dst$/, "");
  const now = prov.now().toISOString();
  const next = (await prov.listGames({ teamId, status: "scheduled", from: new Date(Date.parse(now) - 4 * 3600_000).toISOString() }))[0];
  if (!next) return null;
  const board = await getFantasyBoard(sport, formatId, slateKey(sport, next.date));
  const row = board.rows.find((r) => r.id === playerId);
  if (!row) return null;
  return { row, board, line: await projectedStatLine(row, board.format.id) };
}

export { ordinal };
export type { ScoringFormat };
