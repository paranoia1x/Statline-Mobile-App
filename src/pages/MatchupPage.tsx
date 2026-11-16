import { useState } from "react";
import { provider } from "@/boot";
import { useData } from "@/hooks";
import { forecastGame, getTeamProfiles, headToHead, offenseVsDefense, type TeamProfile } from "@/lib/engine/team";
import { forecastPlayerStat } from "@/lib/engine/service";
import { primaryStat } from "@/lib/server/dashboard";
import { matchupTemplate } from "@/lib/ai/templates";
import { formatStat, SPORTS } from "@/lib/sports";
import { injuryMap, teamMap } from "@/lib/server/lookups";
import { teamBoxScore, teamRosterStats } from "@/lib/server/roster-stats";
import { playerVM, teamVM, type PlayerVM, type TeamVM } from "@/lib/view";
import { labelFor } from "@/lib/engine/verdict";
import { fmtDate, fmtDateTime, pct } from "@/lib/format";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { PlayerInline } from "@/components/cards";
import { PercentileCompare } from "@/components/charts";
import { SaveToVault, TrackPrediction } from "@/components/actions";
import { RosterTables } from "@/components/RosterTables";
import { ErrorBox, ListCard, Loading, Section, Segmented } from "@/components/mobile";
import { AiCallout, AvailabilityBadge, Badge, EmptyState, VerdictBadge } from "@/components/ui";

type KeyRow = { vm: PlayerVM; statLabel: string; statKey: string; projection: number | null; threshold: number | null; pOver: number | null; actual: number | null; verdict: { label: string; side: "over" | "under"; p: number } | null };

async function load(id: string) {
  const game = await provider.getGame(id);
  if (!game) throw new Error("Game not found");
  const sdef = SPORTS[game.sport];
  const [teams, inj, profiles, gf, h2h] = await Promise.all([teamMap(game.sport), injuryMap(game.sport), getTeamProfiles(game.sport), forecastGame(game), headToHead(game.homeTeamId, game.awayTeamId, 10)]);
  const home = teams.get(game.homeTeamId)!;
  const away = teams.get(game.awayTeamId)!;
  const hp = profiles.get(home.id)!;
  const ap = profiles.get(away.id)!;
  const homeEdges = offenseVsDefense(game.sport, hp, ap);
  const awayEdges = offenseVsDefense(game.sport, ap, hp);
  const scheduled = game.status === "scheduled";
  const boxLogs = scheduled ? [] : await provider.getGamePlayerLogs(game.id);
  const [awaySeason, homeSeason, awayBox, homeBox] = await Promise.all([
    teamRosterStats(away, inj, scheduled ? undefined : game.date),
    teamRosterStats(home, inj, scheduled ? undefined : game.date),
    scheduled ? Promise.resolve([]) : teamBoxScore(away, boxLogs, inj),
    scheduled ? Promise.resolve([]) : teamBoxScore(home, boxLogs, inj),
  ]);
  const keyFor = async (tid: string): Promise<KeyRow[]> => {
    const roster = (await provider.listPlayers({ teamId: tid })).filter((p) => p.role === "starter");
    const out: KeyRow[] = [];
    for (const pl of roster.slice(0, 5)) {
      const stat = primaryStat(pl);
      if (!stat) continue;
      let projection: number | null = null, threshold: number | null = null, pOver: number | null = null;
      let verdict: KeyRow["verdict"] = null;
      try {
        const { forecast: f } = await forecastPlayerStat({ playerId: pl.id, statKey: stat.key, gameId: game.id });
        projection = f.projection;
        threshold = f.threshold;
        pOver = f.pOver;
        const side = f.pOver >= f.pUnder ? "over" : "under";
        const pSide = side === "over" ? f.pOver : f.pUnder;
        verdict = { side, p: pSide, label: labelFor(pSide / Math.max(1e-9, f.pOver + f.pUnder), f.confidence.level) };
      } catch {
        /* not enough data */
      }
      const actual = boxLogs.find((l) => l.playerId === pl.id)?.stats[stat.key] ?? null;
      out.push({ vm: playerVM(pl, teams.get(tid), inj.get(pl.id)), statLabel: stat.short, statKey: stat.key, projection, threshold, pOver, actual, verdict });
    }
    return out;
  };
  const [homeKeys, awayKeys] = await Promise.all([keyFor(home.id), keyFor(away.id)]);
  const injuries = (await Promise.all([home.id, away.id].map((t) => provider.listPlayers({ teamId: t })))).flat().filter((p) => inj.has(p.id));
  const narrative = matchupTemplate(home.fullName, away.fullName, gf, [...homeEdges, ...awayEdges].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)), false);
  return { game, sdef, teams, inj, gf, h2h, home, away, hp, ap, homeEdges, awayEdges, scheduled, awaySeason, homeSeason, awayBox, homeBox, homeKeys, awayKeys, injuries, narrative };
}

export default function MatchupPage({ id }: { id: string }) {
  const d = useData(() => load(id), [id]);
  const [tab, setTab] = useState<"players" | "preview" | "compare" | "history">("players");
  if (d.error) return <ErrorBox message={d.error} />;
  if (!d.data) return <Loading rows={4} />;
  const { game, sdef, teams, inj, gf, h2h, home, away, hp, ap, homeEdges, awayEdges, scheduled, awaySeason, homeSeason, awayBox, homeBox, homeKeys, awayKeys, injuries, narrative } = d.data;
  const hv = teamVM(home);
  const av = teamVM(away);
  const rec = (r: { w: number; l: number; d: number }) => `${r.w}-${r.l}${sdef.allowDraw ? `-${r.d}` : ""}`;
  const strip = (p: TeamProfile) => (
    <div className="flex max-w-full flex-wrap justify-center gap-0.5">
      {p.recent.slice(-5).map((l) => (
        <span key={l.gameId} className={`num flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-semibold ${l.result === "W" ? "bg-pos/15 text-pos" : l.result === "L" ? "bg-neg/15 text-neg" : "bg-ink-700 text-ink-200"}`}>{l.result}</span>
      ))}
    </div>
  );
  const compareRows = (side: "offense" | "defense") =>
    (side === "offense" ? hp.offense : hp.defense).map((m) => {
      const other = (side === "offense" ? ap.offense : ap.defense).find((x) => x.def.key === m.def.key)!;
      return { label: m.def.label, a: other.percentile, b: m.percentile, aText: formatStat(other.value, other.def.format), bText: formatStat(m.value, m.def.format) };
    });
  const KeyList = ({ rows, team }: { rows: KeyRow[]; team: TeamVM }) => (
    <Section title={<span className="flex items-center gap-2"><TeamLogo abbreviation={team.abbreviation} name={team.fullName} logoUrl={team.logoUrl} colors={team.colors} size="xs" />{team.abbreviation} key players</span>}>
      <ListCard>
        {rows.map((r) => (
          <div key={r.vm.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <PlayerInline player={r.vm} sub={r.vm.injury ? <AvailabilityBadge status={r.vm.injury.status} description={r.vm.injury.description} /> : null} />
            <div className="shrink-0 text-right text-xs">
              <div className="num text-sm text-white">{r.projection == null ? "—" : r.projection.toFixed(1)} <span className="text-ink-400">{r.statLabel}</span></div>
              {r.pOver != null && <div className="num text-ink-400">P(&gt;{r.threshold}) {pct(r.pOver)}</div>}
              {r.verdict && scheduled && <div className="mt-0.5"><VerdictBadge side={r.verdict.side} label={r.verdict.label} sideWords={["Over", "Under"]} /></div>}
              {!scheduled && <div className="num text-ink-200">Final: {r.actual == null ? "DNP" : r.actual}</div>}
              {scheduled && <a href={`#/predictions?player=${r.vm.id}&game=${game.id}&stat=${r.statKey}`} className="text-brand-light">Forecast →</a>}
            </div>
          </div>
        ))}
      </ListCard>
    </Section>
  );

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-ink-400">
          <span className="flex min-w-0 items-center gap-2">
            <Badge>{sdef.name}</Badge>
            <span className="truncate">{fmtDateTime(game.date)}</span>
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          {[[away, av, ap, `away ${rec(ap.awayRecord)}`], null, [home, hv, hp, `home ${rec(hp.homeRecord)}`]].map((x, i) =>
            x ? (
              <a key={i} href={`#/teams/${(x[0] as typeof home).id}`} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <TeamLogo abbreviation={(x[1] as TeamVM).abbreviation} name={(x[1] as TeamVM).fullName} logoUrl={(x[1] as TeamVM).logoUrl} colors={(x[1] as TeamVM).colors} size="lg" />
                <div className="break-words text-[13px] font-semibold leading-tight text-white">{(x[0] as typeof home).fullName}</div>
                <div className="num text-[10px] text-ink-400">{rec((x[2] as TeamProfile).record)} · {x[3] as string}</div>
                {strip(x[2] as TeamProfile)}
              </a>
            ) : (
              <div key={i} className="text-center">
                <div className="label">{scheduled ? "Projected" : "Final"}</div>
                <div className="num whitespace-nowrap text-xl font-semibold text-white">
                  {scheduled ? gf.awayExpected.toFixed(1) : game.awayScore}
                  <span className="text-ink-500"> – </span>
                  {scheduled ? gf.homeExpected.toFixed(1) : game.homeScore}
                </div>
              </div>
            ),
          )}
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs">
            <span className="num text-ink-200">{away.abbreviation} {pct(gf.pAwayWin, 1)}</span>
            {gf.pDraw > 0 && <span className="num text-ink-400">Draw {pct(gf.pDraw, 1)}</span>}
            <span className="num text-ink-200">{pct(gf.pHomeWin, 1)} {home.abbreviation}</span>
          </div>
          <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
            <div style={{ width: `${gf.pAwayWin * 100}%`, background: "#d95926" }} />
            {gf.pDraw > 0 && <div className="bg-ink-500" style={{ width: `${gf.pDraw * 100}%` }} />}
            <div className="flex-1" style={{ background: "#3987e5" }} />
          </div>
          <div className="mt-2 text-center text-[11px] text-ink-400">
            {!scheduled && <>Pre-game {gf.awayExpected.toFixed(1)}–{gf.homeExpected.toFixed(1)} · </>}Total {gf.projectedTotal.toFixed(1)} · P(&gt;{gf.totalThreshold}) {pct(gf.pTotalOver)} · confidence {gf.confidence}
          </div>
        </div>
        <div className="mt-3">
          <SaveToVault type="matchup" title={`${away.abbreviation} @ ${home.abbreviation} — ${fmtDate(game.date)}`} sport={game.sport} refs={{ teamIds: [away.id, home.id], gameId: game.id }} payload={{ forecast: gf, edges: [...homeEdges, ...awayEdges].map((e) => e.text) }} />
        </div>
      </section>

      <div className="sticky top-[calc(56px+env(safe-area-inset-top))] z-20 -mx-4 bg-ink-950/90 px-4 py-2 backdrop-blur-md">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: "players", label: "Players" },
            { id: "preview", label: "Preview" },
            { id: "compare", label: "Compare" },
            { id: "history", label: "History" },
          ]}
        />
      </div>

      {tab === "players" && (
        <div className="card p-3">
          <RosterTables away={av} home={hv} season={{ away: awaySeason, home: homeSeason }} box={scheduled ? null : { away: awayBox, home: homeBox }} playingTimeShort={sdef.playingTimeShort} gameId={game.id} scheduled={scheduled} />
        </div>
      )}

      {tab === "preview" && (
        <div className="space-y-5">
          <AiCallout title="Matchup summary" source="template">
            <p>{narrative}</p>
            <div className="mt-2 text-xs text-ink-400">{gf.notes.join(" ")}</div>
          </AiCallout>
          {scheduled && (
            <Section title="Track a forecast">
              <div className="grid grid-cols-2 gap-2">
                <TrackPrediction label={`${home.abbreviation} win`} body={{ kind: "game_winner", gameId: game.id, side: "home" }} />
                <TrackPrediction label={`${away.abbreviation} win`} body={{ kind: "game_winner", gameId: game.id, side: "away" }} />
                <TrackPrediction label={`Total > ${gf.totalThreshold}`} body={{ kind: "game_total", gameId: game.id, side: "over" }} />
                <TrackPrediction label={`Total < ${gf.totalThreshold}`} body={{ kind: "game_total", gameId: game.id, side: "under" }} />
              </div>
            </Section>
          )}
          <KeyList rows={awayKeys} team={av} />
          <KeyList rows={homeKeys} team={hv} />
        </div>
      )}

      {tab === "compare" && (
        <div className="space-y-5">
          <Section title="Offense">
            <div className="card p-3"><PercentileCompare rows={compareRows("offense")} aName={away.abbreviation} bName={home.abbreviation} /></div>
          </Section>
          <Section title="Defense">
            <div className="card p-3"><PercentileCompare rows={compareRows("defense")} aName={away.abbreviation} bName={home.abbreviation} /></div>
          </Section>
          {[{ off: av, def: hv, edges: awayEdges }, { off: hv, def: av, edges: homeEdges }].map(({ off, def, edges }) => (
            <Section key={off.id} title={`${off.abbreviation} offense vs ${def.abbreviation} defense`}>
              <ul className="card card-pad space-y-2">
                {edges.map((e) => (
                  <li key={e.offense.def.key} className="flex items-start gap-2 text-sm">
                    <Badge tone={e.verdict === "offense" ? "pos" : e.verdict === "defense" ? "neg" : "neutral"}>{e.verdict === "offense" ? "Off. edge" : e.verdict === "defense" ? "Def. edge" : "Even"}</Badge>
                    <span className="text-ink-300">{e.text}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-5">
          <Section title="Head-to-head">
            {h2h.length ? (
              <ListCard>
                {h2h.map((l) => (
                  <a key={l.gameId} href={`#/matchups/${l.gameId}`} className="flex items-center justify-between px-3.5 py-3 text-sm active:bg-ink-800">
                    <span className="text-ink-300">{fmtDate(l.date, { month: "short", day: "numeric", year: "numeric" })} · at {l.home ? home.abbreviation : away.abbreviation}</span>
                    <span className="num text-ink-100">{home.abbreviation} {l.scoreFor}–{l.scoreAgainst} {away.abbreviation}</span>
                  </a>
                ))}
              </ListCard>
            ) : (
              <EmptyState title="No previous meetings" />
            )}
          </Section>
          <Section title="Injury report">
            {injuries.length ? (
              <ListCard>
                {injuries.map((p) => (
                  <a key={p.id} href={`#/players/${p.id}`} className="flex items-center gap-3 px-3.5 py-2.5">
                    <PlayerAvatar name={p.name} imageUrl={playerVM(p).imageUrl} size="sm" ringColor={teams.get(p.teamId)?.colors.primary} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink-100">{p.name}</div>
                      <div className="truncate text-xs text-ink-400">{teams.get(p.teamId)?.abbreviation} · {inj.get(p.id)!.description}</div>
                    </div>
                    <AvailabilityBadge status={inj.get(p.id)!.status} />
                  </a>
                ))}
              </ListCard>
            ) : (
              <div className="card card-pad text-sm text-ink-400">No tracked players are on the injury report.</div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
