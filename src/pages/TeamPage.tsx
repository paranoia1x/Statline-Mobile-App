import { provider } from "@/boot";
import { useData } from "@/hooks";
import { getTeamProfiles, strengthsAndWeaknesses, type MetricValue } from "@/lib/engine/team";
import { teamFormNotes } from "@/lib/engine/patterns";
import { teamTemplate } from "@/lib/ai/templates";
import { aggregateStat, formatStat, SPORTS, statDef } from "@/lib/sports";
import { injuryMap, teamMap } from "@/lib/server/lookups";
import { playerVM, teamVM } from "@/lib/view";
import { fmtDate, fmtTime } from "@/lib/format";
import { TeamLogo } from "@/components/media";
import { PlayerInline } from "@/components/cards";
import { TrendChart } from "@/components/charts";
import { SaveToVault } from "@/components/actions";
import { ErrorBox, ListCard, Loading, Section } from "@/components/mobile";
import { AiCallout, AvailabilityBadge, Badge, EmptyState, PercentileBar } from "@/components/ui";

function Metrics({ metrics }: { metrics: MetricValue[] }) {
  return (
    <ListCard>
      {metrics.map((m) => (
        <div key={m.def.key} className="px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink-200">{m.def.label}</span>
            <span>
              <span className="num font-semibold text-white">{formatStat(m.value, m.def.format)}</span>
              <span className="num ml-2 text-[11px] text-ink-400">{m.rank ? `#${m.rank}/${m.of}` : "—"}</span>
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <PercentileBar percentile={m.percentile} />
            <span className="num shrink-0 text-[10px] text-ink-500">lg {formatStat(m.leagueAvg, m.def.format)}</span>
          </div>
        </div>
      ))}
    </ListCard>
  );
}

async function load(id: string) {
  const team = await provider.getTeam(id);
  if (!team) throw new Error("Team not found");
  const sdef = SPORTS[team.sport];
  const [profiles, teams, inj, roster, allLogs] = await Promise.all([
    getTeamProfiles(team.sport), teamMap(team.sport), injuryMap(team.sport), provider.listPlayers({ teamId: team.id }), provider.getTeamLogs({ teamId: team.id }),
  ]);
  const prof = profiles.get(team.id)!;
  const sw = strengthsAndWeaknesses(prof);
  const notes = teamFormNotes(allLogs);
  const upcoming = await provider.listGames({ teamId: team.id, from: new Date().toISOString(), status: "scheduled" });
  const trend = allLogs.slice(-20).map((l) => ({ label: fmtDate(l.date), for: l.scoreFor, against: l.scoreAgainst }));
  const rolling = trend.map((t, i) => {
    const w = trend.slice(Math.max(0, i - 4), i + 1);
    return { label: t.label, for: w.reduce((a, b) => a + b.for, 0) / w.length, against: w.reduce((a, b) => a + b.against, 0) / w.length };
  });
  const rosterRows = await Promise.all(
    roster.map(async (pl) => {
      const logs = await provider.getPlayerLogs(pl.id);
      const season = logs.length ? logs[logs.length - 1].season : null;
      const sl = logs.filter((l) => l.season === season);
      const head = (sdef.headline[pl.positionGroup] ?? []).map((k) => statDef(team.sport, k)!).filter(Boolean);
      return { vm: playerVM(pl, team, inj.get(pl.id)), line: head.map((d) => `${formatStat(aggregateStat(d, sl), d.format)} ${d.short}`).join(" · ") };
    }),
  );
  return { team, sdef, prof, sw, notes, teams, upcoming, recent: [...allLogs].slice(-8).reverse(), rolling, rosterRows, narrative: teamTemplate(prof, sw.strengths.map((s) => s.text), sw.weaknesses.map((s) => s.text), false) };
}

export default function TeamPage({ id }: { id: string }) {
  const d = useData(() => load(id), [id]);
  if (d.error) return <ErrorBox message={d.error} />;
  if (!d.data) return <Loading rows={4} />;
  const { team, sdef, prof, sw, notes, teams, upcoming, recent, rolling, rosterRows, narrative } = d.data;
  const vm = teamVM(team);
  const rec = (r: { w: number; l: number; d: number }) => `${r.w}-${r.l}${sdef.allowDraw ? `-${r.d}` : ""}`;
  return (
    <div className="space-y-6">
      <section className="card relative overflow-hidden p-4">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: team.colors.primary }} aria-hidden />
        <div className="flex items-center gap-4">
          <TeamLogo abbreviation={vm.abbreviation} name={vm.fullName} logoUrl={vm.logoUrl} colors={vm.colors} size="xl" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight text-white">{team.fullName}</h2>
            {team.venue && <div className="mt-0.5 truncate text-xs text-ink-400">{team.venue}</div>}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge>{sdef.name}</Badge>
              {team.conference && <Badge>{team.conference}</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[["Record", rec(prof.record)], ["Last 10", rec(prof.last10)], ["Home", rec(prof.homeRecord)], ["Away", rec(prof.awayRecord)]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-ink-700 bg-ink-850 px-1 py-2 text-center">
              <div className="text-[9px] font-medium uppercase tracking-wider text-ink-400">{k}</div>
              <div className="num mt-0.5 text-sm font-semibold text-white">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <SaveToVault type="team" title={`${team.fullName} — team research`} sport={team.sport} refs={{ teamIds: [team.id] }} payload={{ record: prof.record, strengths: sw.strengths.map((s) => s.text), weaknesses: sw.weaknesses.map((s) => s.text) }} />
        </div>
      </section>

      <AiCallout title="Strengths & weaknesses" source="template">
        <p>{narrative}</p>
        <div className="mt-3 space-y-3">
          <div>
            <div className="label mb-1 text-pos">Strengths</div>
            {sw.strengths.length ? sw.strengths.map((s) => <div key={s.metric.def.key} className="text-xs text-ink-300">▲ {s.text}</div>) : <div className="text-xs text-ink-400">None in the top 30%.</div>}
          </div>
          <div>
            <div className="label mb-1 text-neg">Weaknesses</div>
            {sw.weaknesses.length ? sw.weaknesses.map((s) => <div key={s.metric.def.key} className="text-xs text-ink-300">▼ {s.text}</div>) : <div className="text-xs text-ink-400">None in the bottom 30%.</div>}
          </div>
        </div>
        {notes.length > 0 && <div className="mt-3 space-y-1 text-xs text-ink-400">{notes.map((n) => <div key={n}>• {n}</div>)}</div>}
      </AiCallout>

      <Section title={`${sdef.scoreUnit[0].toUpperCase() + sdef.scoreUnit.slice(1)} for vs. against`}>
        <div className="card p-3">
          <TrendChart data={rolling} series={[{ key: "for", name: "Scored" }, { key: "against", name: "Allowed" }]} />
          <p className="mt-1 text-[11px] text-ink-500">Rolling 5-game average, last 20 games</p>
        </div>
      </Section>

      <Section title="Offense">
        <Metrics metrics={prof.offense} />
      </Section>
      <Section title="Defense">
        <Metrics metrics={prof.defense} />
      </Section>

      <Section title="Schedule">
        <ListCard>
          {upcoming.slice(0, 4).map((g) => {
            const opp = teams.get(g.homeTeamId === team.id ? g.awayTeamId : g.homeTeamId)!;
            return (
              <a key={g.id} href={`#/matchups/${g.id}`} className="flex items-center gap-2 px-3.5 py-3 text-sm active:bg-ink-800">
                <span className="w-5 text-ink-500">{g.homeTeamId === team.id ? "vs" : "@"}</span>
                <TeamLogo abbreviation={opp.abbreviation} name={opp.fullName} logoUrl={teamVM(opp).logoUrl} colors={opp.colors} size="xs" />
                <span className="text-ink-100">{opp.fullName}</span>
                <span className="ml-auto text-xs text-ink-400">{fmtDate(g.date)} {fmtTime(g.date)}</span>
              </a>
            );
          })}
          {recent.map((l) => {
            const opp = teams.get(l.opponentId)!;
            return (
              <a key={l.gameId} href={`#/matchups/${l.gameId}`} className="flex items-center gap-2 px-3.5 py-3 text-sm active:bg-ink-800">
                <span className={`num w-5 font-semibold ${l.result === "W" ? "text-pos" : l.result === "L" ? "text-neg" : "text-ink-300"}`}>{l.result}</span>
                <TeamLogo abbreviation={opp.abbreviation} name={opp.fullName} logoUrl={teamVM(opp).logoUrl} colors={opp.colors} size="xs" />
                <span className="text-ink-100">{l.home ? "vs" : "@"} {opp.abbreviation}</span>
                <span className="num ml-auto text-xs text-ink-300">{l.scoreFor}–{l.scoreAgainst} · {fmtDate(l.date)}</span>
              </a>
            );
          })}
        </ListCard>
      </Section>

      <Section title="Roster">
        {rosterRows.length ? (
          <ListCard>
            {rosterRows.map((r) => (
              <div key={r.vm.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <PlayerInline player={r.vm} size="sm" sub={null} />
                <div className="text-right">
                  {r.vm.injury && <AvailabilityBadge status={r.vm.injury.status} description={r.vm.injury.description} />}
                  <div className="num mt-0.5 text-[11px] text-ink-300">{r.line}</div>
                </div>
              </div>
            ))}
          </ListCard>
        ) : (
          <EmptyState title="No roster data" />
        )}
      </Section>
    </div>
  );
}
