import { loadModel, loadPlays, provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { gamesBetween, keyPlayersFor, trendingPerformances } from "@/lib/server/dashboard";
import { gameVM, teamMap } from "@/lib/server/lookups";
import { upcomingPlays } from "@/lib/plays";
import { SPORTS } from "@/lib/sports";
import { SPORT_IDS } from "@/lib/types";
import { teamVM } from "@/lib/view";
import { cx, fmtDate, pct } from "@/lib/format";
import { GameCard } from "@/components/cards";
import { PlayCard } from "@/components/PlayCard";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { Carousel, Disclaimer, ICONS, ListCard, ListRow, Loading, Section } from "@/components/mobile";
import { NavIcon } from "@/components/icons";
import { EmptyState, SportTag } from "@/components/ui";

const TOOLS = [
  { href: "/predictions", label: "AI Predictions", desc: "Hit chance for any line", icon: ICONS.predict },
  { href: "/plays", label: "Top Plays", desc: "Strongest calls today", icon: ICONS.plays },
  { href: "/analyze", label: "Pick Analyzer", desc: "Check picks from a screenshot", icon: ICONS.analyze },
  { href: "/parlay", label: "Parlay Analyzer", desc: "Chance your parlay hits", icon: ICONS.parlay },
];

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : fmtDate(iso);
}

export default function Home() {
  const [sport] = useSport();
  const now = new Date();
  const dayStart = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const games = useData(async () => {
    const [today, teams] = await Promise.all([gamesBetween(sport, dayStart, dayEnd), teamMap(sport)]);
    const key = await keyPlayersFor(today.slice(0, 6));
    return { today: today.map((g) => gameVM(g, teams)), key };
  }, [sport]);

  const live = useData(async () => {
    const teams = await teamMap(sport);
    return ((await provider.liveGames(sport ?? undefined)) ?? [])
      .filter((g) => g.state === "in" && teams.has(g.homeTeamId) && teams.has(g.awayTeamId))
      .map((g) => ({ ...g, home: teamVM(teams.get(g.homeTeamId)!), away: teamVM(teams.get(g.awayTeamId)!) }));
  }, [sport]);

  const plays = useData(async () => upcomingPlays(await loadPlays(), sport).slice(0, 5), [sport]);
  const trending = useData(() => trendingPerformances(sport, 5), [sport]);
  const model = useData(async () => (await loadModel()).filter((b) => !sport || b.sport === sport), [sport]);

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand-deep/45 via-ink-900 to-ink-900 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{fmtDate(now.toISOString(), { weekday: "long", month: "long", day: "numeric" })}</div>
        <div className="mt-1 text-xl font-semibold text-white">{sport ? `${SPORTS[sport].name} today` : "Today across all sports"}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase italic tracking-[0.3em] text-brand-bright/90">Track • Analyze • Win</div>
        <div className="mt-3 text-xs text-ink-300">
          Stats updated {provider.meta ? ago(provider.meta.generatedAt) : "—"} · live scores update automatically
        </div>
      </section>

      {live.data && live.data.length > 0 && (
        <Section title={<span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-neg" /> Live now</span>} action={<a href="#/live" className="text-brand-light">All live →</a>}>
          <Carousel>
            {live.data.map((g) => (
              <a key={g.id} href={`#/matchups/${g.id}`} className="card w-[64vw] max-w-[240px] shrink-0 snap-start p-3">
                <div className="mb-2 flex items-center justify-between text-[11px]">
                  <SportTag sport={g.sport} />
                  <span className="font-semibold text-neg">{g.detail}</span>
                </div>
                {[["away", g.away, g.awayScore] as const, ["home", g.home, g.homeScore] as const].map(([k, t, s]) => (
                  <div key={k} className="flex items-center justify-between py-0.5">
                    <span className="flex items-center gap-2 text-sm text-ink-100">
                      <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="xs" />
                      {t.abbreviation}
                    </span>
                    <span className="num text-lg font-semibold text-white">{s ?? "–"}</span>
                  </div>
                ))}
              </a>
            ))}
          </Carousel>
        </Section>
      )}

      <Section title="Top plays" action={<a href="#/plays" className="text-brand-light">See all →</a>}>
        {plays.loading && !plays.data ? (
          <Loading rows={1} />
        ) : plays.data?.length ? (
          <Carousel>
            {plays.data.map((p, i) => (
              <PlayCard key={p.player.id + p.statKey} play={p} rank={i + 1} compact />
            ))}
          </Carousel>
        ) : (
          <div className="card card-pad text-sm text-ink-400">No qualifying plays in the next 36 hours{sport ? ` for ${SPORTS[sport].name}` : ""}.</div>
        )}
        <p className="px-1 text-[11px] text-ink-500">No play is guaranteed — these are the model's strongest calls, and even those miss a meaningful share of the time.</p>
      </Section>

      <Section title="Tools">
        <div className="grid grid-cols-2 gap-3">
          {TOOLS.map((t) => (
            <a key={t.href} href={`#${t.href}`} className="card flex flex-col gap-2 p-3.5 active:bg-ink-850">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand-bright">
                <NavIcon d={t.icon} className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-ink-100">{t.label}</span>
              <span className="text-[11px] leading-snug text-ink-400">{t.desc}</span>
            </a>
          ))}
        </div>
      </Section>

      <Section title="Today's games" action={<a href="#/matchups" className="text-brand-light">All matchups →</a>}>
        {games.loading && !games.data ? (
          <Loading rows={2} />
        ) : games.data?.today.length ? (
          <div className="space-y-3">
            {games.data.today.slice(0, 6).map((g) => (
              <GameCard key={g.id} game={g} keyPlayers={{ home: games.data!.key.get(g.home.id) ?? [], away: games.data!.key.get(g.away.id) ?? [] }} showSport={!sport} />
            ))}
          </div>
        ) : (
          <EmptyState title="No games today" body="Check Live & Upcoming for the next few days." />
        )}
      </Section>

      {trending.data && trending.data.length > 0 && (
        <Section title="Trending players">
          <ListCard>
            {trending.data.map((t) => (
              <ListRow
                key={t.player.id}
                href={`/players/${t.player.id}`}
                leading={<PlayerAvatar name={t.player.name} imageUrl={t.player.imageUrl} size="sm" ringColor={t.player.team?.colors.primary} />}
                title={t.player.name}
                sub={`${t.pattern.title} · ${t.pattern.detail}`}
              />
            ))}
          </ListCard>
        </Section>
      )}

      {model.data && model.data.length > 0 && (
        <Section title="Model performance" action={<a href="#/tracker" className="text-brand-light">My tracker →</a>}>
          <div className="grid grid-cols-2 gap-3">
            {SPORT_IDS.filter((s) => model.data!.some((b) => b.sport === s)).map((s) => {
              const b = model.data!.find((x) => x.sport === s)!;
              return (
                <div key={s} className="card p-3">
                  <div className="label">{SPORTS[s].name}</div>
                  <div className={cx("num mt-1 text-xl font-semibold", (b.verdictTrack.likely.rate ?? 0) >= 0.6 ? "text-pos" : "text-white")}>{pct(b.verdictTrack.likely.rate)}</div>
                  <div className="text-[11px] text-ink-400">“Likely” calls right · {b.verdictTrack.likely.n.toLocaleString()} past games</div>
                </div>
              );
            })}
          </div>
          <p className="px-1 text-[11px] text-ink-500">Walk-forward backtest: each game forecast using only data from before it.</p>
        </Section>
      )}

      <Disclaimer />
    </div>
  );
}
