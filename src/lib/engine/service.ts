import { getProvider } from "@/lib/data";
import { SPORTS, statDef, statsForGroup } from "@/lib/sports";
import type { Game, Player, SportId } from "@/lib/types";
import { getLeagueContext } from "./context";
import { mean } from "./math";
import { computePlayerForecast, type PlayerForecast } from "./player-forecast";
import { getCalibration } from "./evaluation";

export class ForecastError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Next scheduled game for a team (or null). */
export async function nextGameForTeam(teamId: string): Promise<Game | null> {
  const p = getProvider();
  const now = p.now().toISOString();
  const games = await p.listGames({ teamId, from: now, status: "scheduled" });
  return games.find((g) => g.date > now) ?? null;
}

export async function lastGamesForTeam(teamId: string, n = 5): Promise<Game[]> {
  const p = getProvider();
  const games = await p.listGames({ teamId, to: p.now().toISOString(), status: "final" });
  return games.slice(-n).reverse();
}

const priorCache = new Map<string, Promise<number | null>>();
/** Average of a stat among players of the same sport & position group (shrinkage prior). Concurrent callers share one computation. */
export function positionPrior(sport: SportId, group: string, statKey: string, before: string): Promise<number | null> {
  const key = `${sport}:${group}:${statKey}:${before.slice(0, 10)}`;
  const hit = priorCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const prov = getProvider();
    const players = (await prov.listPlayers({ sport })).filter((x) => x.positionGroup === group);
    const all = await Promise.all(players.map((pl) => prov.getPlayerLogs(pl.id, { before })));
    const vals: number[] = [];
    for (const logs of all)
      for (const l of logs.slice(-40)) {
        const v = l.stats[statKey];
        if (typeof v === "number") vals.push(v);
      }
    return vals.length ? mean(vals) : null;
  })();
  priorCache.set(key, p);
  if (priorCache.size > 2000) priorCache.delete(priorCache.keys().next().value!);
  p.catch(() => priorCache.delete(key));
  return p;
}

export interface ForecastRequest {
  playerId: string;
  statKey: string;
  gameId?: string | null;
  threshold?: number | null;
}

export async function forecastPlayerStat(req: ForecastRequest): Promise<{ forecast: PlayerForecast; player: Player; game: Game | null }> {
  const p = getProvider();
  const player = await p.getPlayer(req.playerId);
  if (!player) throw new ForecastError("Player not found", 404);
  const stat = statDef(player.sport, req.statKey);
  if (!stat) throw new ForecastError(`Unknown statistic "${req.statKey}" for ${SPORTS[player.sport].name}`);
  if (!stat.forecastable) throw new ForecastError(`${stat.label} is a rate statistic and is not forecast directly.`);
  if (!stat.groups.includes(player.positionGroup)) throw new ForecastError(`${stat.label} is not tracked for ${player.position} players.`);
  if (p.unsupportedStats?.(player.sport).includes(stat.key)) throw new ForecastError(`${stat.label} is not provided by the current data source (${p.info.name}).`);

  let game: Game | null = null;
  if (req.gameId) {
    game = await p.getGame(req.gameId);
    if (!game) throw new ForecastError("Game not found", 404);
    if (game.homeTeamId !== player.teamId && game.awayTeamId !== player.teamId)
      throw new ForecastError(`${player.name}'s team is not playing in that game.`);
  } else {
    game = await nextGameForTeam(player.teamId);
    if (!game) throw new ForecastError("No upcoming game found for this player's team.", 404);
  }
  const home = game.homeTeamId === player.teamId;
  const opponentId = home ? game.awayTeamId : game.homeTeamId;
  const logs = await p.getPlayerLogs(player.id, { before: game.date });
  if (!logs.some((l) => typeof l.stats[stat.key] === "number"))
    throw new ForecastError(`No completed games with ${stat.label.toLowerCase()} for ${player.name} in the available data${p.isDemo ? "" : " yet (box scores may still be syncing)"}.`, 422);
  const ctx = await getLeagueContext(player.sport, game.date);
  const isFuture = game.status === "scheduled";
  const injury = isFuture ? await p.getInjury(player.id) : null;
  const prior = await positionPrior(player.sport, player.positionGroup, stat.key, game.date);
  const cal = await getCalibration(player.sport, stat.key);
  const forecast = computePlayerForecast({
    player,
    logs,
    stat,
    opponentId,
    home,
    gameId: game.id,
    gameDate: game.date,
    ctx,
    injury,
    threshold: req.threshold ?? null,
    dataSource: p.isDemo ? "demo" : "live",
    prior,
    calibrationSlope: cal,
    now: p.now(),
  });
  if (!isFuture) forecast.warnings.push("This game has already been played; the forecast uses only data available before tip-off/kick-off.");
  return { forecast, player, game };
}

/** Primary forecastable stats for a player's position group (headline order). */
export function primaryStats(player: Player) {
  const sport = SPORTS[player.sport];
  const head = sport.headline[player.positionGroup] ?? [];
  const f = statsForGroup(player.sport, player.positionGroup).filter((s) => s.forecastable);
  return [...head.map((k) => f.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s), ...f.filter((s) => !head.includes(s.key))];
}
