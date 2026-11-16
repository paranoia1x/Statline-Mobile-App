import { loadPlays } from "@/boot";
import { useData, useSport } from "@/hooks";
import { considered, recentPlays, upcomingPlays } from "@/lib/plays";
import { SPORTS } from "@/lib/sports";
import type { SportId } from "@/lib/types";
import { fmtDate, pct } from "@/lib/format";
import { PlayCard } from "@/components/PlayCard";
import { PlayerAvatar } from "@/components/media";
import { Disclaimer, Loading, Section } from "@/components/mobile";
import { Badge, EmptyState, KPI, Warning } from "@/components/ui";

export default function Plays() {
  const [sport] = useSport();
  const data = useData(async () => {
    const f = await loadPlays();
    return { up: upcomingPlays(f, sport), recent: recentPlays(f, sport), considered: considered(f, sport), track: f.trackRecord, at: f.generatedAt };
  }, [sport]);
  if (!data.data) return <Loading rows={3} />;
  const { up, recent, track, at } = data.data;
  const all = recent.flatMap((d) => d.plays);
  const graded = all.filter((p) => p.result?.status === "hit" || p.result?.status === "miss");
  const hits = graded.filter((p) => p.result!.status === "hit").length;
  const voids = all.filter((p) => p.result?.status === "void").length;
  const record = Object.entries(track).filter(([s, v]) => v.n > 0 && (!sport || s === sport));
  const unders = up.filter((p) => p.side === "under").length;

  return (
    <div className="space-y-6">
      <Warning>
        No play is guaranteed. These are the strongest calls the model can find — only “Likely” calls with medium or high confidence qualify — and even those miss a meaningful share of the time.
      </Warning>
      <div className="grid grid-cols-2 gap-3">
        <KPI label="Last 7 days" value={graded.length ? pct(hits / graded.length) : "—"} sub={`${hits} hit of ${graded.length}${voids ? ` · ${voids} void` : ""}`} tone="ai" />
        <KPI label="Plays now" value={up.length} sub={`from ${data.data.considered.toLocaleString()} calls`} />
        {record.slice(0, 2).map(([s, v]) => (
          <KPI key={s} label={`${SPORTS[s as SportId].name} backtest`} value={pct(v.rate)} sub={`“Likely” right · ${v.n.toLocaleString()} games`} />
        ))}
      </div>

      <Section title="Today & tomorrow">
        {up.length ? (
          <div className="space-y-3">
            {up.map((p, i) => (
              <PlayCard key={p.player.id + p.statKey} play={p} rank={i + 1} />
            ))}
          </div>
        ) : (
          <EmptyState title="No qualifying plays right now" body="Plays appear when the model finds a strong, reliable call for an upcoming game. Check back closer to game time or pick another sport." />
        )}
        {up.length > 0 && unders > up.length / 2 && (
          <p className="px-1 text-[11px] text-ink-500">
            Why mostly “Less”? Player stats are skewed — occasional big games pull the average above the typical game — so a line set at a player's typical output is cleared less than half the time.
          </p>
        )}
        <p className="px-1 text-[11px] text-ink-500">Computed {fmtDate(at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} with typical lines (median of each player's last 10 games).</p>
      </Section>

      <Section title="Recent results">
        <div className="space-y-2">
          {recent.map(({ day, plays }) => {
            const g = plays.filter((p) => p.result?.status === "hit" || p.result?.status === "miss");
            const h = g.filter((p) => p.result!.status === "hit").length;
            return (
              <details key={day} className="card overflow-hidden">
                <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-sm">
                  <span className="text-ink-100">{fmtDate(day, { weekday: "long", month: "short", day: "numeric" })}</span>
                  <span className="num text-ink-300">{plays.length ? `${h}/${g.length} hit` : "no plays"}</span>
                </summary>
                {plays.length > 0 && (
                  <ul className="divide-y divide-ink-800 border-t border-ink-800">
                    {plays.map((p) => (
                      <li key={p.player.id + p.statKey} className="flex items-center gap-3 px-4 py-2.5">
                        <PlayerAvatar name={p.player.name} imageUrl={p.player.imageUrl} size="xs" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink-100">{p.player.name}</span>
                          <span className="block truncate text-[11px] text-ink-400">
                            {p.side === "over" ? "More" : "Less"} {p.line} {p.statLabel} · {pct(p.probability)} · actual {p.result?.actual ?? "—"}
                          </span>
                        </span>
                        <Badge tone={p.result?.status === "hit" ? "pos" : p.result?.status === "miss" ? "neg" : "neutral"}>
                          {p.result?.status === "hit" ? "Hit ✓" : p.result?.status === "miss" ? "Miss ✕" : p.result?.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
        <p className="px-1 text-[11px] text-ink-500">Each day's plays are re-computed using only data from before the games, then graded against final box scores — misses included.</p>
      </Section>
      <Disclaimer />
    </div>
  );
}
