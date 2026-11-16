import { getProvider } from "@/lib/data";
import { SPORTS, statDef, formatStat } from "@/lib/sports";
import type { Game, Player } from "@/lib/types";
import { getLeagueContext } from "./context";
import { mean } from "./math";
import { detectPlayerPatterns, type Pattern } from "./patterns";
import { forecastPlayerStat, ForecastError } from "./service";
import { forecastGame, type GameForecast } from "./team";
import type { PlayerForecast } from "./player-forecast";
import { narrate } from "@/lib/ai/narrate";
import { forecastTemplate } from "@/lib/ai/templates";
import { verdictFor } from "@/lib/server/verdict";
import type { TrackRecord, Verdict } from "./verdict";

export interface ScenarioInput {
  playerId: string;
  statKey: string;
  threshold: number;
  side?: "over" | "under" | null;
  gameId?: string | null;
  gameDate?: string | null; // YYYY-MM-DD, used to find the game when gameId is absent
}

export interface ResearchReport {
  input: ScenarioInput;
  playerId: string;
  teamId: string;
  opponentId: string;
  gameId: string;
  gameDate: string;
  statLabel: string;
  forecast: PlayerForecast;
  windows: { label: string; games: number; avg: number | null; overRate: number | null; minutes: number | null }[];
  defensiveMatchup: { label: string; opponentValue: number | null; leagueValue: number | null; rank: number | null; of: number; text: string } | null;
  offensiveMatchup: { text: string; teamScoring: number | null; leagueScoring: number | null } | null;
  playingTime: { recent: number | null; season: number | null; label: string; text: string };
  injury: { status: string; description: string } | null;
  patterns: Pattern[];
  correlated: { game: GameForecast; notes: string[] };
  concerns: string[];
  uncertainty: string;
  narrative: { text: string; source: "claude" | "template" };
  verdict: Verdict;
  verdictNarrative: { text: string; source: "claude" | "template" };
  trackRecord: TrackRecord | null;
}

async function findGame(player: Player, input: ScenarioInput): Promise<Game | null> {
  const p = getProvider();
  if (input.gameId) return p.getGame(input.gameId);
  if (input.gameDate) {
    const day = Date.parse(input.gameDate + "T00:00:00Z");
    if (Number.isFinite(day)) {
      const games = await p.listGames({ teamId: player.teamId, from: new Date(day - 86_400_000 / 2).toISOString(), to: new Date(day + 1.5 * 86_400_000).toISOString() });
      if (games.length) return games[0];
    }
  }
  return null;
}

export async function buildResearchReport(input: ScenarioInput): Promise<ResearchReport> {
  const prov = getProvider();
  const player = await prov.getPlayer(input.playerId);
  if (!player) throw new ForecastError("Player not found", 404);
  const stat = statDef(player.sport, input.statKey);
  if (!stat) throw new ForecastError("Unknown statistic for this sport");
  const game = await findGame(player, input);
  if ((input.gameId || input.gameDate) && !game) throw new ForecastError(`No ${player.name} game found on ${input.gameDate ?? "that date"}.`, 404);

  const { forecast, game: g } = await forecastPlayerStat({ playerId: player.id, statKey: stat.key, gameId: game?.id ?? null, threshold: input.threshold });
  const theGame = g!;
  const sport = SPORTS[player.sport];
  const logs = (await prov.getPlayerLogs(player.id, { before: theGame.date })).filter((l) => typeof l.stats[stat.key] === "number");
  const season = logs.length ? logs[logs.length - 1].season : null;
  const v = (ls: typeof logs) => ls.map((l) => l.stats[stat.key]);
  const win = (label: string, ls: typeof logs) => ({
    label,
    games: ls.length,
    avg: ls.length ? mean(v(ls)) : null,
    overRate: ls.length ? v(ls).filter((x) => x > input.threshold).length / ls.length : null,
    minutes: ls.length ? mean(ls.map((l) => l.minutes)) : null,
  });
  const opponentId = forecast.opponentId;
  const windows = [
    win("Last 5", logs.slice(-5)),
    win("Last 10", logs.slice(-10)),
    win(`Season ${season ?? ""}`.trim(), logs.filter((l) => l.season === season)),
    win("Vs. opponent (all)", logs.filter((l) => l.opponentId === opponentId)),
    win(forecast.home ? "Home games" : "Road games", logs.filter((l) => l.home === forecast.home)),
  ];

  // defensive matchup: opponent rank in the relevant dimension
  const ctx = await getLeagueContext(player.sport, theGame.date);
  const teams = await prov.listTeams(player.sport);
  const tmap = new Map(teams.map((t) => [t.id, t]));
  let defensiveMatchup: ResearchReport["defensiveMatchup"] = null;
  if (stat.dim) {
    const dim = sport.dims.find((d) => d.id === stat.dim)!;
    const ranked = teams
      .map((t) => ({ id: t.id, ix: ctx.dimIndex(t.id, dim.id) }))
      .filter((x) => x.ix)
      .sort((a, b) => b.ix!.index - a.ix!.index);
    const pos = ranked.findIndex((x) => x.id === opponentId);
    const me = ranked[pos]?.ix ?? null;
    if (me) {
      const rank = pos + 1;
      defensiveMatchup = {
        label: dim.label,
        opponentValue: me.raw,
        leagueValue: me.league,
        rank,
        of: ranked.length,
        text: `${tmap.get(opponentId)?.fullName} ranks ${rank} of ${ranked.length} in ${dim.label.toLowerCase()} (1 = most ${dim.source === "allowed" ? "allowed" : "generated"}): ${me.raw!.toFixed(1)} per game vs league ${me.league!.toFixed(1)}.`,
      };
    }
  }
  const myTeam = ctx.teams.get(player.teamId);
  const offensiveMatchup = myTeam
    ? {
        teamScoring: myTeam.scoreFor,
        leagueScoring: ctx.leagueScore,
        text: `${tmap.get(player.teamId)?.fullName} average ${myTeam.scoreFor.toFixed(1)} ${sport.scoreUnit} per game over their last ${myTeam.games} (league ${ctx.leagueScore.toFixed(1)}); opponent allows ${(ctx.teams.get(opponentId)?.scoreAgainst ?? NaN).toFixed(1)}.`,
      }
    : null;

  const recentMin = logs.length ? mean(logs.slice(-5).map((l) => l.minutes)) : null;
  const seasonMin = logs.length ? mean(logs.filter((l) => l.season === season).map((l) => l.minutes)) : null;
  const playingTime = {
    recent: recentMin,
    season: seasonMin,
    label: sport.playingTimeLabel,
    text:
      recentMin != null && seasonMin != null
        ? `${sport.playingTimeLabel}: ${recentMin.toFixed(1)} over the last 5 vs ${seasonMin.toFixed(1)} this season.`
        : "Playing-time history unavailable.",
  };
  const injury = theGame.status === "scheduled" ? await prov.getInjury(player.id) : null;
  const allLogs = await prov.getPlayerLogs(player.id, { before: theGame.date });
  const patterns = detectPlayerPatterns(player, allLogs);
  const gf = await forecastGame(theGame);
  const margin = forecast.home ? gf.homeExpected - gf.awayExpected : gf.awayExpected - gf.homeExpected;
  const correlatedNotes: string[] = [
    `Projected game total ${gf.projectedTotal.toFixed(1)} ${sport.scoreUnit} (league scoring environment ${(ctx.leagueScore * 2).toFixed(1)}).`,
    `Projected margin for ${tmap.get(player.teamId)?.abbreviation}: ${margin >= 0 ? "+" : ""}${margin.toFixed(1)}.`,
  ];
  if (Math.abs(margin) > sport.marginSd * 0.8 && (player.sport === "nba" || player.sport === "nfl"))
    correlatedNotes.push("A lopsided projected margin raises the chance of reduced late-game playing time for starters (blowout risk).");
  if (player.sport === "nfl" && stat.dim === "pass" && margin < -3) correlatedNotes.push("Trailing game scripts tend to increase passing volume.");
  if (player.sport === "nfl" && stat.dim === "run" && margin > 3) correlatedNotes.push("Leading game scripts tend to increase rushing volume.");

  const concerns: string[] = [...forecast.warnings];
  const l10 = windows[1];
  if (l10.games < 10) concerns.push(`Only ${l10.games} recent games available.`);
  if (windows[3].games < 3) concerns.push(`Head-to-head sample is very small (${windows[3].games} games) and carries little weight.`);
  const cv = forecast.distribution.sd / Math.max(0.01, forecast.distribution.mean);
  if (cv > 0.6) concerns.push(`High game-to-game volatility (coefficient of variation ${cv.toFixed(2)}): outcomes far from the projection are common.`);
  if (Math.abs(forecast.projection - input.threshold) < forecast.distribution.sd * 0.15)
    concerns.push("The threshold sits very close to the projection, so the estimate is close to a coin flip.");
  if (forecast.context.length) concerns.push(...forecast.context.filter((c) => c.startsWith("Recent role")));

  const tracked = input.side ?? (forecast.pOver >= forecast.pUnder ? "over" : "under");
  const pSide = tracked === "over" ? forecast.pOver : forecast.pUnder;
  const uncertainty = `80% of simulated outcomes fall between ${formatStat(forecast.interval80[0], "dec1")} and ${formatStat(forecast.interval80[1], "dec1")}. The model estimates a ${(pSide * 100).toFixed(1)}% chance of finishing ${tracked === "over" ? "above" : "below"} ${input.threshold}${forecast.pPush > 0.001 ? ` (${(forecast.pPush * 100).toFixed(1)}% exactly ${input.threshold})` : ""}. Estimates are calibrated on a walk-forward backtest but remain uncertain.`;

  const fallback = forecastTemplate(forecast, player.name, tmap.get(opponentId)?.fullName ?? "the opponent", prov.isDemo);
  const narrative = await narrate(
    "research report",
    {
      player: player.name,
      opponent: tmap.get(opponentId)?.fullName,
      statistic: stat.label,
      threshold: input.threshold,
      projection: +forecast.projection.toFixed(2),
      probabilityAbove: +forecast.pOver.toFixed(3),
      probabilityBelow: +forecast.pUnder.toFixed(3),
      confidence: forecast.confidence.level,
      windows: windows.map((w) => ({ label: w.label, games: w.games, average: w.avg == null ? null : +w.avg.toFixed(2) })),
      supportingEvidence: forecast.supporting.map((e) => e.text),
      conflictingEvidence: forecast.conflicting.map((e) => e.text),
      concerns,
      dataIsDemo: prov.isDemo,
    },
    fallback,
  );

  const vd = await verdictFor(forecast, player.sport, player.name, tmap.get(opponentId)?.fullName ?? "the opponent", input.side ?? null, prov.isDemo);

  return {
    input,
    verdict: vd.verdict,
    verdictNarrative: vd.narrative,
    trackRecord: vd.trackRecord,
    playerId: player.id,
    teamId: player.teamId,
    opponentId,
    gameId: theGame.id,
    gameDate: theGame.date,
    statLabel: stat.label,
    forecast,
    windows,
    defensiveMatchup,
    offensiveMatchup,
    playingTime,
    injury: injury ? { status: injury.status, description: injury.description } : null,
    patterns,
    correlated: { game: gf, notes: correlatedNotes },
    concerns,
    uncertainty,
    narrative,
  };
}
