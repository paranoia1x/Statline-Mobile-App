import { useState } from "react";
import { provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { forecastGame } from "@/lib/engine/team";
import { gameVM, teamMap } from "@/lib/server/lookups";
import { fmtDate, fmtTime, pct } from "@/lib/format";
import { TeamLogo } from "@/components/media";
import { Loading } from "@/components/mobile";
import { EmptyState, SportTag } from "@/components/ui";

export default function Matchups() {
  const [sport] = useSport();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const start = new Date(date + "T00:00:00Z");
  const shift = (d: number) => setDate(new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10));
  const d = useData(async () => {
    const teams = await teamMap();
    const games = await provider.listGames({ sport: sport ?? undefined, from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() });
    return Promise.all(games.map(async (g) => ({ vm: gameVM(g, teams), f: await forecastGame(g) })));
  }, [sport, date]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button className="btn px-3" onClick={() => shift(-1)} aria-label="Previous day">←</button>
        <input type="date" className="input flex-1 text-center" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        <button className="btn px-3" onClick={() => shift(1)} aria-label="Next day">→</button>
      </div>
      <div className="flex items-center justify-between px-1 text-xs text-ink-300">
        <span>{fmtDate(start.toISOString(), { weekday: "long", month: "long", day: "numeric" })} · {d.data?.length ?? "…"} games</span>
        {date !== today && <button className="text-brand-light" onClick={() => setDate(today)}>Today</button>}
      </div>
      {!d.data ? (
        <Loading rows={3} />
      ) : d.data.length ? (
        <div className="space-y-3">
          {d.data.map(({ vm, f }) => {
            const final = vm.status === "final";
            return (
              <a key={vm.id} href={`#/matchups/${vm.id}`} className="card block p-4 active:bg-ink-850">
                <div className="mb-3 flex items-center justify-between text-[11px] text-ink-400">
                  <span className="flex items-center gap-2">{!sport && <SportTag sport={vm.sport} />}{final ? "Final" : fmtTime(vm.date)}</span>
                  <span className="truncate pl-2">{vm.venue}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {[vm.away, null, vm.home].map((t, i) =>
                    t ? (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                        <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="lg" />
                        <span className="text-xs text-ink-200">{t.fullName}</span>
                      </div>
                    ) : (
                      <div key={i} className="text-center">{final ? <div className="num text-xl font-semibold text-white">{vm.awayScore}–{vm.homeScore}</div> : <div className="text-xs text-ink-500">@</div>}</div>
                    ),
                  )}
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-[11px] text-ink-400">
                    <span className="num">{pct(f.pAwayWin)}</span>
                    <span>{final ? "Pre-game model" : "Win probability"}{f.pDraw > 0 ? ` · draw ${pct(f.pDraw)}` : ""}</span>
                    <span className="num">{pct(f.pHomeWin)}</span>
                  </div>
                  <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full">
                    <div style={{ width: `${f.pAwayWin * 100}%`, background: "#d95926" }} />
                    {f.pDraw > 0 && <div className="bg-ink-500" style={{ width: `${f.pDraw * 100}%` }} />}
                    <div className="flex-1" style={{ background: "#3987e5" }} />
                  </div>
                  <div className="mt-2 text-center text-[11px] text-ink-400">Projected {f.awayExpected.toFixed(1)} – {f.homeExpected.toFixed(1)}</div>
                  <div className="mt-2 text-center text-xs font-medium text-brand-light">Players &amp; stats →</div>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No games on this date" body="Use the arrows or the date picker to browse the schedule." />
      )}
    </div>
  );
}
