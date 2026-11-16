import { provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { visibleStats } from "@/lib/data";
import { injuryMap, teamMap } from "@/lib/server/lookups";
import { aggregateStat, formatStat, SPORTS } from "@/lib/sports";
import { playerVM } from "@/lib/view";
import { cx } from "@/lib/format";
import { navigate } from "@/router";
import { PlayerAvatar } from "@/components/media";
import { ListCard, Loading } from "@/components/mobile";
import { EmptyState } from "@/components/ui";

const RANGES = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "season", label: "Season" },
];

export default function Stats({ query }: { query: URLSearchParams }) {
  const [chosen] = useSport();
  const sport = chosen ?? "nba";
  const sdef = SPORTS[sport];
  const range = query.get("range") ?? "season";
  const group = query.get("position") ?? "";
  const statsAvail = visibleStats(sport, group || undefined);
  const statKey = statsAvail.some((s) => s.key === query.get("stat")) ? query.get("stat")! : statsAvail[0]?.key;
  const stat = sdef.stats.find((s) => s.key === statKey)!;
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
    navigate(`/stats?${n}`, { replace: true });
  };

  const d = useData(async () => {
    const from = range === "season" ? undefined : new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    const [teams, inj, players] = await Promise.all([teamMap(sport), injuryMap(sport), provider.listPlayers({ sport })]);
    const rows = [];
    for (const pl of players) {
      if (!stat.groups.includes(pl.positionGroup) || (group && pl.positionGroup !== group)) continue;
      let logs = await provider.getPlayerLogs(pl.id);
      if (range === "season") {
        const season = logs.length ? logs[logs.length - 1].season : null;
        logs = logs.filter((l) => l.season === season);
      } else logs = logs.filter((l) => l.date >= from!);
      logs = logs.filter((l) => typeof l.stats[stat.key] === "number" || stat.ratio);
      if (logs.length < 3) continue;
      rows.push({ vm: playerVM(pl, teams.get(pl.teamId), inj.get(pl.id)), games: logs.length, value: aggregateStat(stat, logs) });
    }
    const asc = stat.higherIsBetter === false;
    rows.sort((a, b) => ((a.value ?? -Infinity) - (b.value ?? -Infinity)) * (asc ? 1 : -1));
    return rows.slice(0, 50);
  }, [sport, range, group, statKey]);

  return (
    <div className="space-y-4">
      {!chosen && <div className="px-1 text-xs text-ink-400">Showing NBA — pick a sport above to switch leaderboards.</div>}
      <div className="flex gap-1.5">
        {RANGES.map((r) => (
          <button key={r.id} className={cx("chip flex-1 justify-center py-1.5", range === r.id && "chip-active")} onClick={() => set({ range: r.id })}>{r.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={statKey} onChange={(e) => set({ stat: e.target.value })} aria-label="Statistic">
          {statsAvail.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <select className="input" value={group} onChange={(e) => set({ position: e.target.value, stat: "" })} aria-label="Position">
          <option value="">All positions</option>
          {sdef.positionGroups.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
      </div>
      {!d.data ? (
        <Loading rows={5} />
      ) : d.data.length ? (
        <ListCard>
          {d.data.map((r, i) => (
            <a key={r.vm.id} href={`#/players/${r.vm.id}`} className="flex items-center gap-3 px-3.5 py-2.5 active:bg-ink-800">
              <span className={cx("num w-6 text-center text-sm font-semibold", i < 3 ? "text-brand-light" : "text-ink-500")}>{i + 1}</span>
              <PlayerAvatar name={r.vm.name} imageUrl={r.vm.imageUrl} size="sm" ringColor={r.vm.team?.colors.primary} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink-100">{r.vm.name}</div>
                <div className="text-[11px] text-ink-400">{r.vm.team?.abbreviation} · {r.vm.position} · {r.games} G</div>
              </div>
              <div className="text-right">
                <div className="num text-lg font-semibold text-white">{formatStat(r.value, stat.format)}</div>
                <div className="text-[10px] uppercase text-ink-500">{stat.short}</div>
              </div>
            </a>
          ))}
        </ListCard>
      ) : (
        <EmptyState title="No players qualify" body="Players need at least 3 games in this window." />
      )}
      <p className="px-1 text-[11px] text-ink-500">Per-game averages; percentages combine made/attempted totals. Minimum 3 games.</p>
    </div>
  );
}
