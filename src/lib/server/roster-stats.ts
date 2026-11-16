import { getProvider, visibleStats } from "@/lib/data";
import { aggregateStat, formatStat, SPORTS, type StatDef } from "@/lib/sports";
import type { Injury, PlayerGameLog, Team } from "@/lib/types";
import { playerVM, type PlayerVM } from "@/lib/view";

export interface RosterRow {
  player: PlayerVM;
  games: number;
  minutes: string;
  values: string[];
  /** Last-5 average of the group's first statistic, for a quick form read. */
  last5: string | null;
}
export interface RosterGroup {
  id: string;
  label: string;
  columns: { key: string; short: string; label: string }[];
  rows: RosterRow[];
}

function columnsFor(sport: Team["sport"], group: string): StatDef[] {
  const head = SPORTS[sport].headline[group] ?? [];
  const stats = visibleStats(sport, group);
  const ordered = [...head.map((k) => stats.find((s) => s.key === k)).filter((s): s is StatDef => !!s), ...stats.filter((s) => !head.includes(s.key))];
  return ordered.filter((s) => s.key !== "pra" && s.key !== "usage").slice(0, 7);
}

const cell = (v: number | null, f: StatDef["format"]) => (v != null && Number.isInteger(v) && f !== "pct" && f !== "avg3" ? String(v) : formatStat(v, f));

/** Season-to-date per-game stats for every tracked player on a team, grouped by position. */
export async function teamRosterStats(team: Team, injuries: Map<string, Injury>, before?: string): Promise<RosterGroup[]> {
  const prov = getProvider();
  const sdef = SPORTS[team.sport];
  const roster = await prov.listPlayers({ teamId: team.id });
  const logsList = await Promise.all(roster.map((p) => prov.getPlayerLogs(p.id, before ? { before } : undefined)));
  const groups: RosterGroup[] = [];
  for (const g of sdef.positionGroups) {
    const cols = columnsFor(team.sport, g.id);
    const rows: RosterRow[] = [];
    roster.forEach((p, i) => {
      if (p.positionGroup !== g.id) return;
      const all = logsList[i];
      const season = all.length ? all[all.length - 1].season : null;
      const sl = all.filter((l) => l.season === season && l.teamId === team.id);
      if (!sl.length) return; // no games for this team yet: leave out rather than show empty rows
      const l5 = sl.slice(-5);
      rows.push({
        player: playerVM(p, team, injuries.get(p.id)),
        games: sl.length,
        minutes: (sl.reduce((a, l) => a + l.minutes, 0) / sl.length).toFixed(1),
        values: cols.map((c) => formatStat(aggregateStat(c, sl), c.format)),
        last5: cols[0] ? formatStat(aggregateStat(cols[0], l5), cols[0].format) : null,
      });
    });
    rows.sort((a, b) => b.games * Number.parseFloat(b.minutes) - a.games * Number.parseFloat(a.minutes));
    if (rows.length) groups.push({ id: g.id, label: g.label, columns: cols.map((c) => ({ key: c.key, short: c.short, label: c.label })), rows });
  }
  return groups;
}

/** Final box score for one team in one game, grouped by position. */
export async function teamBoxScore(team: Team, logs: PlayerGameLog[], injuries: Map<string, Injury>): Promise<RosterGroup[]> {
  const prov = getProvider();
  const mine = logs.filter((l) => l.teamId === team.id);
  const players = await Promise.all(mine.map((l) => prov.getPlayer(l.playerId)));
  const groups: RosterGroup[] = [];
  for (const g of SPORTS[team.sport].positionGroups) {
    const cols = columnsFor(team.sport, g.id);
    const rows: RosterRow[] = [];
    mine.forEach((l, i) => {
      const p = players[i];
      if (!p || p.positionGroup !== g.id) return;
      rows.push({
        player: playerVM(p, team, injuries.get(p.id)),
        games: 1,
        minutes: l.minutes.toFixed(1),
        values: cols.map((c) => cell(aggregateStat(c, [l]), c.format)),
        last5: null,
      });
    });
    rows.sort((a, b) => Number.parseFloat(b.minutes) - Number.parseFloat(a.minutes));
    if (rows.length) groups.push({ id: g.id, label: g.label, columns: cols.map((c) => ({ key: c.key, short: c.short, label: c.label })), rows });
  }
  return groups;
}
