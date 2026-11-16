import { useState } from "react";
import { provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { nextGameForTeam } from "@/lib/engine/service";
import { injuryMap, teamMap } from "@/lib/server/lookups";
import { aggregateStat, formatStat, SPORTS, statDef } from "@/lib/sports";
import { playerVM, teamVM } from "@/lib/view";
import { fmtDate } from "@/lib/format";
import { navigate } from "@/router";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { Loading } from "@/components/mobile";
import { AvailabilityBadge, EmptyState, SportTag } from "@/components/ui";

const PAGE = 40;

export default function Players({ query }: { query: URLSearchParams }) {
  const [sport] = useSport();
  const [q, setQ] = useState(query.get("q") ?? "");
  const team = query.get("team") ?? "";
  const pos = query.get("position") ?? "";
  const status = query.get("status") ?? "";
  const [limit, setLimit] = useState(PAGE);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(query);
    if (v) n.set(k, v);
    else n.delete(k);
    navigate(`/players?${n}`, { replace: true });
  };

  const base = useData(async () => {
    const [teams, inj, all] = await Promise.all([teamMap(sport), injuryMap(sport), provider.listPlayers({ sport: sport ?? undefined })]);
    return { teams, inj, all };
  }, [sport]);

  const needle = q.trim().toLowerCase();
  const filtered = (base.data?.all ?? []).filter((pl) => {
    const t = base.data!.teams.get(pl.teamId);
    if (needle && !`${pl.name} ${t?.fullName} ${t?.abbreviation} ${pl.position}`.toLowerCase().includes(needle)) return false;
    if (team && pl.teamId !== team) return false;
    if (pos && pl.positionGroup !== pos) return false;
    const st = base.data!.inj.get(pl.id)?.status ?? "active";
    if (status === "available" && st !== "active") return false;
    if (status === "injured" && st === "active") return false;
    return true;
  });
  const shown = filtered.slice(0, limit);

  const cards = useData(async () => {
    if (!base.data) return [];
    const { teams, inj } = base.data;
    const next = new Map<string, Awaited<ReturnType<typeof nextGameForTeam>>>();
    for (const tid of new Set(shown.map((x) => x.teamId))) next.set(tid, await nextGameForTeam(tid));
    return Promise.all(
      shown.map(async (pl) => {
        const logs = await provider.getPlayerLogs(pl.id);
        const season = logs.length ? logs[logs.length - 1].season : null;
        const sl = logs.filter((l) => l.season === season);
        const head = (SPORTS[pl.sport].headline[pl.positionGroup] ?? []).map((k) => statDef(pl.sport, k)!).filter(Boolean);
        const g = next.get(pl.teamId);
        const oppId = g ? (g.homeTeamId === pl.teamId ? g.awayTeamId : g.homeTeamId) : null;
        return {
          vm: playerVM(pl, teams.get(pl.teamId), inj.get(pl.id)),
          stats: head.map((d) => ({ short: d.short, v: formatStat(aggregateStat(d, sl), d.format) })),
          games: sl.length,
          next: g && oppId ? { date: g.date, opp: teamVM(teams.get(oppId)!), home: g.homeTeamId === pl.teamId } : null,
        };
      }),
    );
  }, [base.data, shown.map((p) => p.id).join(",")]);

  const groups = sport ? SPORTS[sport].positionGroups : [];
  return (
    <div className="space-y-4">
      <input className="input" type="search" placeholder="Search name, team or position" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} aria-label="Search players" />
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        <select className="input w-auto shrink-0" value={team} onChange={(e) => set("team", e.target.value)} aria-label="Team">
          <option value="">All teams</option>
          {[...(base.data?.teams.values() ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((t) => (
            <option key={t.id} value={t.id}>{t.fullName}</option>
          ))}
        </select>
        {sport && (
          <select className="input w-auto shrink-0" value={pos} onChange={(e) => set("position", e.target.value)} aria-label="Position">
            <option value="">All positions</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        )}
        <select className="input w-auto shrink-0" value={status} onChange={(e) => set("status", e.target.value)} aria-label="Availability">
          <option value="">Any status</option>
          <option value="available">Available</option>
          <option value="injured">Injury listed</option>
        </select>
      </div>
      {!base.data ? (
        <Loading rows={4} />
      ) : (
        <>
          <div className="px-1 text-xs text-ink-400">{filtered.length.toLocaleString()} player{filtered.length === 1 ? "" : "s"}</div>
          {!filtered.length ? (
            <EmptyState title="No players match" body="Try a different name or clear the filters." />
          ) : !cards.data ? (
            <Loading rows={4} />
          ) : (
            <div className="space-y-3">
              {cards.data.map(({ vm, stats, games, next }) => (
                <a key={vm.id} href={`#/players/${vm.id}`} className="card block p-3.5 active:bg-ink-850">
                  <div className="flex items-center gap-3">
                    <PlayerAvatar name={vm.name} imageUrl={vm.imageUrl} size="lg" ringColor={vm.team?.colors.primary} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink-100">{vm.name}</span>
                        {!sport && <SportTag sport={vm.sport} />}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
                        {vm.team && <TeamLogo abbreviation={vm.team.abbreviation} name={vm.team.fullName} logoUrl={vm.team.logoUrl} colors={vm.team.colors} size="xs" />}
                        {vm.team?.abbreviation} · {vm.position} · #{vm.jersey}
                      </div>
                      <div className="mt-1">
                        <AvailabilityBadge status={vm.injury?.status ?? "active"} description={vm.injury?.description} seasonEnding={vm.injury?.seasonEnding} returns={vm.injury?.expectedReturn} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-ink-850 p-2">
                    {stats.map((s) => (
                      <div key={s.short} className="text-center">
                        <div className="num text-sm font-semibold text-white">{s.v}</div>
                        <div className="text-[10px] uppercase tracking-wider text-ink-400">{s.short}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
                    <span>{games} games this season</span>
                    {next ? (
                      <span className="flex items-center gap-1">
                        Next: {next.home ? "vs" : "@"} {next.opp.abbreviation} · {fmtDate(next.date)}
                      </span>
                    ) : (
                      <span>No upcoming game</span>
                    )}
                  </div>
                </a>
              ))}
              {filtered.length > limit && (
                <button className="btn w-full" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more ({(filtered.length - limit).toLocaleString()} left)
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
