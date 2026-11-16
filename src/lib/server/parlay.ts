/**
 * Parlay analysis: probability for each leg (player props from the player
 * model, team legs from the team model) and the chance that every leg hits.
 * Legs are combined as independent events; legs from the same game are
 * flagged because they are usually correlated.
 */
import { getProvider } from "@/lib/data";
import { forecastPlayerStat } from "@/lib/engine/service";
import { teamMarketProbability } from "@/lib/engine/team";
import { labelFor } from "@/lib/engine/verdict";
import { fairAmerican, impliedProbability, type Leg } from "@/lib/parse/parlay";
import { statDef, SPORTS } from "@/lib/sports";
import type { Game } from "@/lib/types";
import { playerVM, teamVM, type PlayerVM, type TeamVM } from "@/lib/view";

export interface LegInput {
  leg: Leg;
  odds?: number | null;
}

export interface LegResult {
  index: number;
  ok: boolean;
  error?: string;
  kind: Leg["kind"];
  description: string;
  sport?: string;
  gameId?: string;
  gameDate?: string;
  gameStatus?: Game["status"];
  player?: PlayerVM;
  team?: TeamVM;
  opponent?: TeamVM;
  probability: number;
  push: number;
  label: string;
  confidence?: "low" | "medium" | "high";
  detail: string;
  odds: number | null;
  impliedProbability: number | null;
  live?: boolean; // game has started but is not final
  outcome?: Outcome; // set when the game is already final
  actual?: string;
}

export interface ParlayResult {
  legs: LegResult[];
  probability: number | null; // chance every (valid) leg wins
  label: string | null;
  fairOdds: number | null;
  parlayOdds: number | null;
  impliedProbability: number | null;
  sameGameGroups: string[][]; // descriptions of legs sharing a game
  weakestLeg: number | null;
  expectedHits: number;
  settled: { won: number; lost: number; push: number; void: number; pending: number; busted: boolean };
}

const HOUR = 3_600_000;

/**
 * The game a slip leg refers to: a game in progress first (ESPN keeps those "scheduled" until
 * final), then the next scheduled one; with both teams named, the game between them —
 * including one that finished in the last 36 hours, so a settled slip can be checked.
 */
async function slipGameFor(teamId: string, opponentId?: string): Promise<Game | null> {
  const prov = getProvider();
  const now = prov.now().getTime();
  const games = (await prov.listGames({ teamId, from: new Date(now - 36 * HOUR).toISOString(), to: new Date(now + 21 * 24 * HOUR).toISOString() }))
    .filter((g) => !opponentId || g.homeTeamId === opponentId || g.awayTeamId === opponentId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const t = (g: Game) => Date.parse(g.date);
  const live = games.find((g) => g.status === "scheduled" && t(g) <= now && t(g) > now - 6 * HOUR);
  const next = games.find((g) => g.status === "scheduled" && t(g) > now);
  const recentFinal = [...games].reverse().find((g) => g.status === "final" && t(g) > now - 36 * HOUR);
  if (live) return live;
  if (opponentId && recentFinal && (!next || t(next) - now > 24 * HOUR)) return recentFinal;
  if (next) return next;
  return opponentId ? recentFinal ?? null : null;
}

type Outcome = "won" | "lost" | "push" | "void";
const cmp = (actual: number, line: number, side: "over" | "under"): Outcome => (actual === line ? "push" : (actual > line) === (side === "over") ? "won" : "lost");

/** Settles a leg whose game is final. */
async function settle(game: Game, leg: Leg): Promise<{ outcome: Outcome; actual: string } | null> {
  if (game.status !== "final" || game.homeScore == null || game.awayScore == null) return null;
  if (leg.kind === "player") {
    const log = (await getProvider().getGamePlayerLogs(game.id)).find((l) => l.playerId === leg.playerId);
    const v = log?.stats[leg.statKey];
    if (typeof v !== "number") return { outcome: "void", actual: "Did not play" };
    return { outcome: cmp(v, leg.line, leg.side), actual: `Finished with ${v}` };
  }
  const home = leg.teamId === game.homeTeamId;
  const mine = home ? game.homeScore : game.awayScore;
  const theirs = home ? game.awayScore : game.homeScore;
  const score = `Final ${mine}–${theirs}`;
  switch (leg.kind) {
    case "moneyline":
      return { outcome: mine > theirs ? "won" : mine < theirs ? "lost" : "push", actual: score };
    case "draw":
      return { outcome: mine === theirs ? "won" : "lost", actual: score };
    case "spread":
      return { outcome: cmp(mine - theirs + leg.line, 0, "over"), actual: score };
    case "total":
      return { outcome: cmp(mine + theirs, leg.line, leg.side), actual: `Final total ${mine + theirs}` };
  }
}

export async function analyzeParlay(inputs: LegInput[], parlayOdds: number | null): Promise<ParlayResult> {
  const prov = getProvider();
  const legs: LegResult[] = await Promise.all(
    inputs.map(async ({ leg, odds }, index): Promise<LegResult> => {
      const base = { index, kind: leg.kind, odds: odds ?? null, impliedProbability: odds ? impliedProbability(odds) : null, probability: 0, push: 0, label: "—", detail: "" };
      try {
        if (leg.kind === "player") {
          const player = await prov.getPlayer(leg.playerId);
          if (!player) throw new Error("Player not found");
          const slipGame = await slipGameFor(player.teamId, leg.opponentId);
          if (!slipGame) throw new Error(`No upcoming game found for ${player.name}`);
          const { forecast: f, game } = await forecastPlayerStat({ playerId: leg.playerId, statKey: leg.statKey, threshold: leg.line, gameId: slipGame.id });
          const teams = await prov.listTeams(player.sport);
          const team = teams.find((t) => t.id === player.teamId)!;
          const opp = teams.find((t) => t.id === f.opponentId)!;
          const p = leg.side === "over" ? f.pOver : f.pUnder;
          const injury = await prov.getInjury(player.id);
          return {
            ...base,
            ok: true,
            description: `${player.name} ${leg.side === "over" ? "Over" : "Under"} ${leg.line} ${statDef(player.sport, leg.statKey)?.label ?? leg.statKey}`,
            sport: player.sport,
            gameId: game?.id,
            gameDate: game?.date,
            gameStatus: game?.status,
            live: !!game && game.status === "scheduled" && Date.parse(game.date) <= prov.now().getTime(),
            player: playerVM(player, team, injury),
            team: teamVM(team),
            opponent: teamVM(opp),
            probability: p,
            push: f.pPush,
            label: labelFor(p / Math.max(1e-9, f.pOver + f.pUnder), f.confidence.level),
            confidence: f.confidence.level,
            detail: f.ruledOut
              ? `⚠ ${injury?.seasonEnding ? "Out for the season" : "Ruled out"} — this leg will most likely be voided · projection if he played ${f.projection.toFixed(1)}`
              : `Projection ${f.projection.toFixed(1)} · ${f.sample.games} games of data${f.teammatesOut?.players.length ? ` · ${f.teammatesOut.players[0].name} out` : ""}`,
            ...(game ? await settle(game, leg) : null),
          };
        }
        const team = await prov.getTeam(leg.teamId);
        if (!team) throw new Error("Team not found");
        const game = await slipGameFor(team.id, leg.opponentId);
        if (!game) throw new Error(leg.opponentId ? `No recent or upcoming game between these teams` : `No upcoming ${team.fullName} game found`);
        const oppId = game.homeTeamId === team.id ? game.awayTeamId : game.homeTeamId;
        const opp = (await prov.getTeam(oppId))!;
        const m = await teamMarketProbability(game, leg);
        const unit = SPORTS[team.sport].scoreUnit;
        const description =
          leg.kind === "moneyline"
            ? `${team.fullName} to win`
            : leg.kind === "draw"
              ? `${team.abbreviation} vs ${opp.abbreviation} — draw`
              : leg.kind === "spread"
                ? `${team.fullName} ${leg.line > 0 ? "+" : ""}${leg.line}`
                : `${team.abbreviation}/${opp.abbreviation} ${leg.side === "over" ? "Over" : "Under"} ${leg.line} total ${unit}`;
        const detail =
          leg.kind === "total"
            ? `Projected total ${m.expected.total.toFixed(1)} ${unit}`
            : `Projected score ${team.abbreviation} ${m.expected.team.toFixed(1)} – ${opp.abbreviation} ${m.expected.opponent.toFixed(1)}`;
        return {
          ...base,
          ok: true,
          description,
          sport: team.sport,
          gameId: game.id,
          gameDate: game.date,
          gameStatus: game.status,
          live: game.status === "scheduled" && Date.parse(game.date) <= prov.now().getTime(),
          team: teamVM(team),
          opponent: teamVM(opp),
          probability: m.p,
          push: m.push,
          label: labelFor(m.p / Math.max(1e-9, 1 - m.push), m.forecast.confidence),
          confidence: m.forecast.confidence,
          detail,
          ...(await settle(game, leg)),
        };
      } catch (e) {
        return { ...base, ok: false, error: (e as Error).message, description: "Could not analyse this leg" };
      }
    }),
  );

  const valid = legs.filter((l) => l.ok);
  // settled legs count as certain (won / push / void) or zero (lost); pending legs use the model
  const legP = (l: LegResult) => (l.outcome === "lost" ? 0 : l.outcome ? 1 : l.probability);
  const probability = valid.length ? valid.reduce((a, l) => a * legP(l), 1) : null;
  const byGame = new Map<string, string[]>();
  for (const l of valid) if (l.gameId) byGame.set(l.gameId, [...(byGame.get(l.gameId) ?? []), l.description]);
  const sameGameGroups = [...byGame.values()].filter((g) => g.length > 1);
  const legOdds = valid.map((l) => l.odds);
  const combinedFromLegs = legOdds.length && legOdds.every((o) => o != null) ? legOdds.reduce((a, o) => a * (1 / impliedProbability(o!)), 1) : null;
  const effectiveOdds = parlayOdds ?? (combinedFromLegs ? Math.round((combinedFromLegs - 1) * 100) : null);
  const pending = valid.filter((l) => !l.outcome);
  const weakest = pending.length ? pending.reduce((a, b) => (b.probability < a.probability ? b : a)).index : null;

  return {
    legs,
    probability,
    label: probability == null ? null : labelFor(probability, valid.some((l) => l.confidence === "low") ? "low" : "medium"),
    fairOdds: probability != null ? fairAmerican(probability) : null,
    parlayOdds: effectiveOdds,
    impliedProbability: effectiveOdds != null ? impliedProbability(effectiveOdds) : null,
    sameGameGroups,
    weakestLeg: weakest,
    expectedHits: valid.reduce((a, l) => a + (l.outcome ? (l.outcome === "won" ? 1 : 0) : l.probability), 0),
    settled: {
      won: valid.filter((l) => l.outcome === "won").length,
      lost: valid.filter((l) => l.outcome === "lost").length,
      push: valid.filter((l) => l.outcome === "push").length,
      void: valid.filter((l) => l.outcome === "void").length,
      pending: valid.filter((l) => !l.outcome).length,
      busted: valid.some((l) => l.outcome === "lost"),
    },
  };
}
