import { provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { visibleStats } from "@/lib/data";
import { forecastPlayerStat, nextGameForTeam } from "@/lib/engine/service";
import { labelFor } from "@/lib/engine/verdict";
import { activeLines } from "@/lib/lines";
import { primaryStat } from "@/lib/server/dashboard";
import { gameVM, injuryMap, teamMap } from "@/lib/server/lookups";
import { SPORTS, statDef } from "@/lib/sports";
import { SPORT_IDS, type SportId } from "@/lib/types";
import { playerVM, teamVM } from "@/lib/view";
import { pct } from "@/lib/format";
import { LinesPanel, type BoardRow } from "@/components/LinesPanel";
import { ForecastStudio, type StudioGame } from "@/components/ForecastStudio";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { ICONS, ListCard, Loading, Section } from "@/components/mobile";
import { NavIcon } from "@/components/icons";
import { ConfidencePill, VerdictBadge } from "@/components/ui";

async function loadStudio(filterSport: SportId | null, q: URLSearchParams) {
  let initialGame = q.get("game") ?? undefined;
  const initialPlayer = q.get("player") ?? undefined;
  let sport = filterSport;
  const pre = initialPlayer ? await provider.getPlayer(initialPlayer) : null;
  if (pre) {
    sport = pre.sport;
    if (!initialGame) initialGame = (await nextGameForTeam(pre.teamId))?.id;
  }
  const now = new Date();
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  let games = (await provider.listGames({ sport: sport ?? undefined, from: now.toISOString(), to: new Date(now.getTime() + 7 * 86_400_000).toISOString(), status: "scheduled" })).slice(0, sport ? 40 : 60);
  if (initialGame && !games.some((g) => g.id === initialGame)) {
    const g = await provider.getGame(initialGame);
    if (g && g.status === "scheduled") games = [g, ...games];
  }
  const rosters: Record<string, ReturnType<typeof playerVM>[]> = {};
  const teamIds = [...new Set(games.flatMap((g) => [g.awayTeamId, g.homeTeamId]))];
  const lists = await Promise.all(teamIds.map((tid) => provider.listPlayers({ teamId: tid })));
  teamIds.forEach((tid, i) => (rosters[tid] = lists[i].map((p) => playerVM(p, teams.get(p.teamId), inj.get(p.id)))));
  const studioGames: StudioGame[] = games.map((g) => gameVM(g, teams));
  const statsBySport = Object.fromEntries(SPORT_IDS.map((s) => [s, visibleStats(s).filter((x) => x.forecastable).map((x) => ({ key: x.key, label: x.label, groups: x.groups }))]));

  // PrizePicks lines imported on this phone
  const lines = await activeLines("local", filterSport);
  const rows = await Promise.all(
    lines.slice(0, 120).map(async (l): Promise<BoardRow | null> => {
      const pl = await provider.getPlayer(l.playerId);
      if (!pl) return null;
      const row: BoardRow = {
        player: playerVM(pl, teams.get(pl.teamId), inj.get(pl.id)), opponent: "", gameId: l.gameId, gameDate: l.gameDate, statKey: l.statKey,
        statLabel: statDef(l.sport, l.statKey)?.label ?? l.statKey, line: l.line, origin: l.origin,
        projection: null, pOver: null, pUnder: null, verdict: null, confidence: null, error: null,
      };
      try {
        const { forecast: f, game } = await forecastPlayerStat({ playerId: l.playerId, statKey: l.statKey, gameId: l.gameId, threshold: l.line });
        if (f.ruledOut) throw new Error(inj.get(pl.id)?.seasonEnding ? "Out for the season — not expected to play" : "Ruled out — not expected to play");
        const side = f.pOver >= f.pUnder ? "over" : "under";
        const pSide = side === "over" ? f.pOver : f.pUnder;
        Object.assign(row, {
          projection: f.projection, pOver: f.pOver, pUnder: f.pUnder, confidence: f.confidence, gameId: game?.id ?? l.gameId, gameDate: game?.date ?? l.gameDate,
          verdict: { side, p: pSide, label: labelFor(pSide / Math.max(1e-9, f.pOver + f.pUnder), f.confidence.level) },
          opponent: teams.get(f.opponentId)?.abbreviation ?? "",
        });
      } catch (e) {
        row.error = (e as Error).message;
      }
      return row;
    }),
  );
  return {
    key: `${initialGame ?? ""}|${initialPlayer ?? ""}|${q.get("stat") ?? ""}|${q.get("threshold") ?? ""}`,
    studioGames, rosters, statsBySport,
    lines: lines.map((l) => ({ playerId: l.playerId, statKey: l.statKey, line: l.line, gameId: l.gameId })),
    boardRows: rows.filter((r): r is BoardRow => !!r),
    initial: { gameId: initialGame, playerId: initialPlayer, statKey: q.get("stat") ?? undefined, threshold: q.get("threshold") ?? undefined },
  };
}

/** Model board: starters' primary stat in the next 48 hours, strongest calibrated leans first. */
async function loadBoard(sport: SportId | null) {
  const now = new Date();
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  const games = (await provider.listGames({ sport: sport ?? undefined, from: now.toISOString(), to: new Date(now.getTime() + 48 * 3600_000).toISOString(), status: "scheduled" })).slice(0, 10);
  const cands = (await Promise.all(games.flatMap((g) => [g.homeTeamId, g.awayTeamId].map(async (tid) => (await provider.listPlayers({ teamId: tid })).map((pl) => ({ pl, g, tid }))))))
    .flat()
    .filter(({ pl }) => pl.role === "starter" && inj.get(pl.id)?.status !== "out" && primaryStat(pl));
  const out = (
    await Promise.all(
      cands.map(async ({ pl, g, tid }) => {
        const stat = primaryStat(pl)!;
        try {
          const { forecast: f } = await forecastPlayerStat({ playerId: pl.id, statKey: stat.key, gameId: g.id });
          if (f.confidence.level === "low") return null;
          return { vm: playerVM(pl, teams.get(tid), inj.get(pl.id)), opp: teamVM(teams.get(f.opponentId)!), gameId: g.id, statKey: stat.key, statLabel: stat.label, f };
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => !!x);
  return out.sort((a, b) => Math.max(b.f.pOver, b.f.pUnder) - Math.max(a.f.pOver, a.f.pUnder)).slice(0, 15);
}

export default function Predict({ query }: { query: URLSearchParams }) {
  const [sport] = useSport();
  const qs = query.toString();
  const studio = useData(() => loadStudio(sport, new URLSearchParams(qs)), [sport, qs], { watchStore: true });
  const board = useData(() => loadBoard(sport), [sport]);

  return (
    <div className="space-y-6">
      <a href="#/fantasy" className="card flex items-center gap-3 border-brand/30 p-3.5 active:bg-ink-850">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand-bright">
          <NavIcon d={ICONS.fantasy} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-100">Fantasy projections</span>
          <span className="block text-[11px] text-ink-400">Projected points, defense vs position, team totals{sport === "nfl" || !sport ? ", weather" : ""}</span>
        </span>
        <NavIcon d={ICONS.chevron} className="h-4 w-4 text-ink-500" />
      </a>
      <p className="px-1 text-xs leading-relaxed text-ink-400">
        Pick a game and player to see the projected stat, the chance of going over or under a line, confidence, and the reasons for and against. PrizePicks lines you import are used automatically.
      </p>
      {!studio.data ? (
        <Loading rows={3} />
      ) : (
        <>
          <LinesPanel rows={studio.data.boardRows} signedIn feedConfigured={false} />
          <ForecastStudio key={studio.data.key} games={studio.data.studioGames} rosters={studio.data.rosters} lines={studio.data.lines} statsBySport={studio.data.statsBySport} initial={studio.data.initial} />
        </>
      )}

      <Section title="Model board">
        <p className="-mt-1 px-1 text-[11px] text-ink-400">Starters' main stat in the next 48 hours vs each player's typical line (median of his last 10 games), strongest calls first. Players ruled out are left off.</p>
        {!board.data ? (
          <Loading rows={2} />
        ) : board.data.length ? (
          <ListCard>
            {board.data.map((b) => {
              const side = b.f.pOver >= b.f.pUnder ? "over" : "under";
              const p = side === "over" ? b.f.pOver : b.f.pUnder;
              return (
                <a key={b.vm.id + b.gameId} href={`#/predictions?player=${b.vm.id}&game=${b.gameId}&stat=${b.statKey}`} className="flex items-center gap-3 px-3.5 py-3 active:bg-ink-800">
                  <PlayerAvatar name={b.vm.name} imageUrl={b.vm.imageUrl} size="sm" ringColor={b.vm.team?.colors.primary} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-100">{b.vm.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
                      vs <TeamLogo abbreviation={b.opp.abbreviation} name={b.opp.fullName} logoUrl={b.opp.logoUrl} colors={b.opp.colors} size="xs" /> {b.opp.abbreviation} · {b.statLabel} {b.f.threshold}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <VerdictBadge side={side} label={labelFor(p / Math.max(1e-9, b.f.pOver + b.f.pUnder), b.f.confidence.level)} sideWords={["Over", "Under"]} />
                      <ConfidencePill level={b.f.confidence.level} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-lg font-semibold text-white">{pct(p)}</div>
                    <div className="num text-[10px] text-ink-500">proj {b.f.projection.toFixed(1)}</div>
                  </div>
                </a>
              );
            })}
          </ListCard>
        ) : (
          <div className="card card-pad text-sm text-ink-400">No games in the next 48 hours{sport ? ` for ${SPORTS[sport].name}` : ""}.</div>
        )}
        {board.data && board.data.filter((b) => b.f.pUnder > b.f.pOver).length > board.data.length / 2 && (
          <p className="px-1 text-[11px] text-ink-500">
            Why mostly “Under”? Player stats are skewed — a few big games pull the average up — so most games land under a line set at a player's typical output. The backtest confirms these calls hit at the rates shown.
          </p>
        )}
        <p className="px-1 text-[11px] text-ink-500">Probabilities are estimates for research, not guarantees or recommendations.</p>
      </Section>
    </div>
  );
}
