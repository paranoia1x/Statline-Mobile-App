import { provider } from "@/boot";
import { useData } from "@/hooks";
import { visibleStats } from "@/lib/data";
import { computeSplits, getLeagueContext } from "@/lib/engine/context";
import { detectPlayerPatterns } from "@/lib/engine/patterns";
import { nextGameForTeam } from "@/lib/engine/service";
import { mean } from "@/lib/engine/math";
import { aggregateStat, formatStat, SPORTS } from "@/lib/sports";
import { teamMap } from "@/lib/server/lookups";
import { playerVM, teamVM } from "@/lib/view";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { PlayerCharts, type LogRow } from "@/components/PlayerCharts";
import { RecordRecentPlayer, SaveToVault } from "@/components/actions";
import { ErrorBox, Loading, Section } from "@/components/mobile";
import { AvailabilityBadge, Badge, EmptyState, Warning } from "@/components/ui";

function cellFmt(v: number | null, f: Parameters<typeof formatStat>[1]) {
  if (v != null && Number.isInteger(v) && f !== "pct" && f !== "avg3") return String(v);
  return formatStat(v, f);
}

async function load(id: string) {
  const player = await provider.getPlayer(id);
  if (!player) throw new Error("Player not found");
  const sport = SPORTS[player.sport];
  const teams = await teamMap(player.sport);
  const team = teams.get(player.teamId)!;
  const [injury, logs, next] = await Promise.all([provider.getInjury(player.id), provider.getPlayerLogs(player.id), nextGameForTeam(player.teamId)]);
  const stats = visibleStats(player.sport, player.positionGroup);
  const splits = computeSplits(player, logs, stats);
  const patterns = detectPlayerPatterns(player, logs);
  const oppId = next ? (next.homeTeamId === player.teamId ? next.awayTeamId : next.homeTeamId) : null;
  const opp = oppId ? teams.get(oppId) ?? null : null;
  const h2h = oppId ? logs.filter((l) => l.opponentId === oppId) : [];
  const primary = stats.find((s) => s.key === (sport.headline[player.positionGroup] ?? [])[0]);
  let similar: { teamIds: string[]; games: typeof logs } | null = null;
  if (opp && primary?.dim && next) {
    const ctx = await getLeagueContext(player.sport, next.date);
    const target = ctx.dimIndex(opp.id, primary.dim)?.index;
    if (target) {
      const ids = [...teams.keys()].filter((t) => t !== opp.id && t !== player.teamId && Math.abs((ctx.dimIndex(t, primary.dim!)?.index ?? 99) - target) < 0.04);
      similar = { teamIds: ids, games: logs.filter((l) => ids.includes(l.opponentId)) };
    }
  }
  const logRows: LogRow[] = logs.map((l) => ({ date: l.date, label: fmtDate(l.date), opp: teams.get(l.opponentId)?.abbreviation ?? "?", home: l.home, minutes: l.minutes, season: l.season, stats: l.stats }));
  const usageCandidate = player.sport === "nba" ? "usg" : player.sport === "nfl" && player.positionGroup !== "QB" ? "usage" : null;
  const usageKey = usageCandidate && stats.some((s) => s.key === usageCandidate) && logs.some((l) => typeof l.stats[usageCandidate] === "number") ? usageCandidate : null;
  return { player, sport, teams, team, injury, logs, next, vm: playerVM(player, team, injury), stats, splits, patterns, opp, h2h, primary, similar, logRows, usageKey };
}

export default function PlayerPage({ id }: { id: string }) {
  const d = useData(() => load(id), [id]);
  if (d.error) return <ErrorBox message={d.error} />;
  if (!d.data) return <Loading rows={4} />;
  const { player, sport, teams, team, injury, logs, next, vm, stats, splits, patterns, opp, h2h, primary, similar, logRows, usageKey } = d.data;
  const tableStats = stats.slice(0, 9);
  const recentLogs = [...logs].reverse().slice(0, 15);
  const roleNote = patterns.find((x) => x.kind === "role");

  return (
    <div className="space-y-6">
      <RecordRecentPlayer id={player.id} />
      <section className="card relative overflow-hidden p-4">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: team.colors.primary }} aria-hidden />
        <div className="flex items-center gap-4">
          <PlayerAvatar name={player.name} imageUrl={vm.imageUrl} size="xl" ringColor={team.colors.primary} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold leading-tight text-white">{player.name}</h2>
            <a href={`#/teams/${team.id}`} className="mt-1 flex items-center gap-1.5 text-sm text-ink-300">
              <TeamLogo abbreviation={team.abbreviation} name={team.fullName} logoUrl={teamVM(team).logoUrl} colors={team.colors} size="xs" />
              <span className="truncate">{team.fullName}</span>
            </a>
            <div className="mt-1 text-xs text-ink-400">
              {player.position} · #{player.jersey}
              {player.age ? ` · Age ${player.age}` : ""}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{sport.name}</Badge>
          <AvailabilityBadge status={injury?.status ?? "active"} description={injury?.description} />
        </div>
        {injury && (
          <div className="mt-2 text-xs text-ink-300">
            Injury: <span className="text-ink-100">{injury.description}</span> · updated {fmtDate(injury.updatedAt)}
            {injury.expectedReturn && <> · return ~{fmtDate(injury.expectedReturn)}</>}
          </div>
        )}
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-850 p-3">
          <div className="label mb-2">Next game</div>
          {next && opp ? (
            <a href={`#/matchups/${next.id}`} className="flex items-center gap-3">
              <TeamLogo abbreviation={opp.abbreviation} name={opp.fullName} logoUrl={teamVM(opp).logoUrl} colors={opp.colors} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink-100">
                  {next.homeTeamId === player.teamId ? "vs" : "@"} {opp.fullName}
                </div>
                <div className="text-xs text-ink-400">{fmtDateTime(next.date)}</div>
              </div>
            </a>
          ) : (
            <div className="text-sm text-ink-400">No upcoming game scheduled</div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {next ? (
              <a href={`#/predictions?player=${player.id}&game=${next.id}`} className="btn btn-primary">AI forecast</a>
            ) : (
              <span />
            )}
            <SaveToVault type="player" title={`${player.name} — player research`} sport={player.sport} refs={{ playerIds: [player.id], teamIds: [team.id] }} payload={{ splits: splits.slice(0, 5) }} label="Save" />
          </div>
        </div>
      </section>

      {roleNote && <Warning>Recent role change — {roleNote.title.toLowerCase()}: {roleNote.detail}</Warning>}

      <Section title="Game log chart">
        <div className="card p-3">
          <PlayerCharts logs={logRows} stats={stats.map((s) => ({ key: s.key, label: s.label, short: s.short, ratio: !!s.ratio }))} playingTimeLabel={sport.playingTimeLabel} usageKey={usageKey} usageLabel={sport.usageLabel} />
        </div>
      </Section>

      <Section title="Splits">
        {logs.length ? (
          <div className="card no-scrollbar overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-ink-900">Split</th>
                  <th className="text-right">G</th>
                  <th className="text-right">{sport.playingTimeShort}</th>
                  {stats.map((s) => (
                    <th key={s.key} className="text-right">{s.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {splits.map((r) => (
                  <tr key={r.label}>
                    <td className="sticky left-0 z-10 bg-ink-900 font-medium text-ink-100">{r.label}</td>
                    <td className="num text-right">{r.games}</td>
                    <td className="num text-right">{r.minutes == null ? "—" : r.minutes.toFixed(1)}</td>
                    {stats.map((s) => (
                      <td key={s.key} className="num text-right">{formatStat(r.values[s.key], s.format)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No completed games" body="Stats appear once this player has played in a completed game." />
        )}
        <p className="px-1 text-[11px] text-ink-500">Swipe the table sideways for more stats · {logs.length} completed games</p>
      </Section>

      <Section title="Detected patterns">
        <div className="card card-pad">
          {patterns.length ? (
            <ul className="space-y-3">
              {patterns.slice(0, 6).map((pt, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={pt.direction === "up" ? "pos" : pt.direction === "down" ? "neg" : "neutral"}>{pt.kind}</Badge>
                    <span className="text-ink-100">{pt.title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-400">{pt.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-ink-400">No statistically notable changes — recent output is within normal variance.</div>
          )}
        </div>
      </Section>

      <Section title={opp ? `History vs ${opp.abbreviation}` : "Head-to-head"}>
        <div className="card card-pad">
          {opp && h2h.length ? (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th>
                  {tableStats.slice(0, 3).map((s) => (
                    <th key={s.key} className="text-right">{s.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h2h.slice(-6).reverse().map((l) => (
                  <tr key={l.gameId}>
                    <td>{fmtDate(l.date, { month: "short", day: "numeric", year: "2-digit" })} {l.home ? "vs" : "@"}</td>
                    {tableStats.slice(0, 3).map((s) => (
                      <td key={s.key} className="num text-right">{cellFmt(aggregateStat(s, [l]), s.format)}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="font-medium text-ink-100">Average</td>
                  {tableStats.slice(0, 3).map((s) => (
                    <td key={s.key} className="num text-right font-medium text-white">{formatStat(aggregateStat(s, h2h), s.format)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-ink-400">{opp ? "No prior meetings in the available data." : "No upcoming opponent."}</div>
          )}
          {similar && primary && (
            <div className="mt-3 border-t border-ink-800 pt-3 text-xs text-ink-300">
              <div className="label mb-1">Vs. similar opponents</div>
              {similar.games.length ? (
                <>
                  {primary.label}: <span className="num text-white">{formatStat(aggregateStat(primary, similar.games), primary.format)}</span> per game across {similar.games.length} games vs {similar.teamIds.map((t) => teams.get(t)?.abbreviation).join(", ")}.
                </>
              ) : (
                "No opponents with a similar defensive profile in the current window."
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Recent games">
        {recentLogs.length ? (
          <div className="card no-scrollbar overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-ink-900">Game</th>
                  <th className="text-right">{sport.playingTimeShort}</th>
                  {tableStats.map((s) => (
                    <th key={s.key} className="text-right">{s.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((l) => {
                  const o = teams.get(l.opponentId)!;
                  return (
                    <tr key={l.gameId}>
                      <td className="sticky left-0 z-10 bg-ink-900">
                        <a href={`#/matchups/${l.gameId}`} className="flex items-center gap-1.5">
                          <span className="text-[11px] text-ink-500">{fmtDate(l.date)}</span>
                          <span className="text-ink-500">{l.home ? "vs" : "@"}</span>
                          <TeamLogo abbreviation={o.abbreviation} name={o.fullName} logoUrl={teamVM(o).logoUrl} colors={o.colors} size="xs" />
                          {o.abbreviation}
                        </a>
                      </td>
                      <td className="num text-right">{l.minutes.toFixed(1)}</td>
                      {tableStats.map((s) => (
                        <td key={s.key} className="num text-right">{cellFmt(aggregateStat(s, [l]), s.format)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No games played yet" />
        )}
        <p className="px-1 text-[11px] text-ink-500">Avg {sport.playingTimeShort} last 10: {logs.length ? mean(logs.slice(-10).map((l) => l.minutes)).toFixed(1) : "—"}</p>
      </Section>
    </div>
  );
}
