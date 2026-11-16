import { provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { forecastGame } from "@/lib/engine/team";
import { gameVM, teamMap } from "@/lib/server/lookups";
import { teamVM } from "@/lib/view";
import { fmtDate, fmtTime, pct } from "@/lib/format";
import { LiveBoard } from "@/components/LiveBoard";
import { TeamLogo } from "@/components/media";
import { ListCard, Loading, Section } from "@/components/mobile";
import { SportTag } from "@/components/ui";

export default function Live() {
  const [sport] = useSport();
  const live = useData(async () => {
    const teams = await teamMap(sport);
    return ((await provider.liveGames(sport ?? undefined)) ?? [])
      .filter((g) => teams.has(g.homeTeamId) && teams.has(g.awayTeamId))
      .map((g) => ({ ...g, home: teamVM(teams.get(g.homeTeamId)!), away: teamVM(teams.get(g.awayTeamId)!) }));
  }, [sport]);

  const upcoming = useData(async () => {
    const teams = await teamMap(sport);
    const tomorrow = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() + 86_400_000;
    const games = await provider.listGames({ sport: sport ?? undefined, from: new Date(tomorrow).toISOString(), to: new Date(tomorrow + 7 * 86_400_000).toISOString(), status: "scheduled" });
    const rows = await Promise.all(games.map(async (g) => ({ vm: gameVM(g, teams), f: await forecastGame(g) })));
    const days = new Map<string, typeof rows>();
    for (const x of rows) days.set(x.vm.date.slice(0, 10), [...(days.get(x.vm.date.slice(0, 10)) ?? []), x]);
    return [...days.entries()];
  }, [sport]);

  return (
    <div className="space-y-7">
      {live.data ? <LiveBoard key={sport ?? "all"} initial={live.data} sport={sport} /> : <Loading rows={2} />}
      {live.data && provider.liveSource === "snapshot" && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          Live scores can't be reached right now — showing the schedule and final scores from the last stats update.
        </div>
      )}
      <a href="#/matchups" className="btn w-full">Browse all matchups →</a>
      <Section title="Upcoming days">
        {!upcoming.data ? (
          <Loading rows={2} />
        ) : upcoming.data.length === 0 ? (
          <div className="card card-pad text-sm text-ink-400">No games scheduled in the next 7 days.</div>
        ) : (
          <div className="space-y-4">
            {upcoming.data.map(([day, list]) => (
              <div key={day}>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-300">{fmtDate(day + "T12:00:00Z", { weekday: "long", month: "short", day: "numeric" })}</span>
                  <span className="text-[11px] text-ink-500">{list.length} game{list.length === 1 ? "" : "s"}</span>
                </div>
                <ListCard>
                  {list.map(({ vm, f }) => (
                    <a key={vm.id} href={`#/matchups/${vm.id}`} className="flex items-center gap-3 px-3.5 py-3 active:bg-ink-800">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {([["away", vm.away, f.pAwayWin], ["home", vm.home, f.pHomeWin]] as const).map(([k, t, p]) => (
                          <div key={k} className="flex items-center gap-2 text-sm">
                            <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="xs" />
                            <span className="min-w-0 flex-1 truncate text-ink-100">{t.fullName}</span>
                            <span className="num text-xs text-ink-300">{pct(p)}</span>
                          </div>
                        ))}
                        {f.pDraw > 0 && <div className="num pl-8 text-[11px] text-ink-500">Draw {pct(f.pDraw)}</div>}
                      </div>
                      <div className="w-16 shrink-0 text-right text-[11px] text-ink-400">
                        {!sport && <SportTag sport={vm.sport} />}
                        <div className="mt-1">{fmtTime(vm.date)}</div>
                      </div>
                    </a>
                  ))}
                </ListCard>
              </div>
            ))}
          </div>
        )}
        <p className="px-1 text-[11px] text-ink-500">Win chances come from the team model (recent scoring, opponent strength, home advantage). They are estimates, not guarantees.</p>
      </Section>
    </div>
  );
}
