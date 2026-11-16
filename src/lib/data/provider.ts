import type { DataSourceInfo, Game, Injury, LiveGame, Player, PlayerGameLog, SportId, Team, TeamGameLog } from "@/lib/types";

export interface GameFilter {
  sport?: SportId;
  teamId?: string;
  from?: string; // ISO inclusive
  to?: string; // ISO exclusive
  status?: "scheduled" | "final";
}

/**
 * Contract every sports statistics provider implements. Providers must only
 * return results for games that have actually been completed; scheduled games
 * carry null scores. Image data is NOT part of this contract (see lib/images).
 */
export interface SportsDataProvider {
  readonly info: DataSourceInfo;
  readonly isDemo: boolean;
  now(): Date;
  listTeams(sport?: SportId): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  listPlayers(filter?: { sport?: SportId; teamId?: string }): Promise<Player[]>;
  getPlayer(id: string): Promise<Player | null>;
  listGames(filter?: GameFilter): Promise<Game[]>;
  getGame(id: string): Promise<Game | null>;
  /** Completed-game logs for a player, oldest first. */
  getPlayerLogs(playerId: string, opts?: { before?: string }): Promise<PlayerGameLog[]>;
  getGamePlayerLogs(gameId: string): Promise<PlayerGameLog[]>;
  /** Completed-game team logs, oldest first. */
  getTeamLogs(filter: { teamId?: string; sport?: SportId; before?: string }): Promise<TeamGameLog[]>;
  getInjuries(sport?: SportId): Promise<Injury[]>;
  getInjury(playerId: string): Promise<Injury | null>;
  /** Stat keys this provider cannot supply for a sport (hidden from forecasting). */
  unsupportedStats?(sport: SportId): string[];
  /** Games around today with live state and scores (refreshes frequently). */
  liveGames?(sport?: SportId): Promise<LiveGame[]>;
  /** Background synchronisation progress, for providers that sync remotely. */
  syncStatus?(): { sport: SportId; total: number; done: number; failed: number; running: boolean; finishedAt: number | null }[];
  /** Start loading data in the background (called once at server start). */
  warmAll?(): void;
}
