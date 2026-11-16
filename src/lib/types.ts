export type SportId = "nba" | "nfl" | "mlb" | "nhl" | "soccer";
export const SPORT_IDS: SportId[] = ["nba", "nfl", "mlb", "nhl", "soccer"];

export type VerificationStatus = "verified" | "unverified" | "unavailable";

/** Image data is stored separately from statistical data. */
export interface ImageAsset {
  entityType: "player" | "team";
  entityId: string;
  url: string | null;
  source: string | null;
  verification: VerificationStatus;
  updatedAt: string | null;
}

export interface Team {
  id: string;
  sport: SportId;
  city: string;
  name: string;
  fullName: string;
  abbreviation: string;
  conference: string;
  venue: string;
  colors: { primary: string; secondary: string };
}

export type AvailabilityStatus = "active" | "day-to-day" | "questionable" | "doubtful" | "out";

export interface Player {
  id: string;
  sport: SportId;
  teamId: string;
  firstName: string;
  lastName: string;
  name: string;
  position: string;
  positionGroup: string;
  jersey: number;
  age: number;
  role: "starter" | "rotation" | "reserve";
}

export interface Injury {
  playerId: string;
  status: AvailabilityStatus;
  description: string;
  updatedAt: string;
  expectedReturn: string | null;
  /** Ruled out for the rest of the season (ESPN "OFS", season-ending surgery, etc.). */
  seasonEnding?: boolean;
  /** Latest news blurb about the injury, when the source provides one. */
  note?: string | null;
}

export type GameStatus = "scheduled" | "final";

export interface Game {
  id: string;
  sport: SportId;
  season: string;
  date: string; // ISO datetime
  homeTeamId: string;
  awayTeamId: string;
  venue: string;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
}

/** Real-time state of a game (scoreboard). */
export interface LiveGame {
  id: string;
  sport: SportId;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  state: "pre" | "in" | "post";
  homeScore: number | null;
  awayScore: number | null;
  /** e.g. "Q3 5:21", "2nd 12:00", "Bot 7th", "Final", "7:30 PM ET" */
  detail: string;
  venue: string;
}

export interface PlayerGameLog {
  playerId: string;
  gameId: string;
  sport: SportId;
  season: string;
  date: string;
  teamId: string;
  opponentId: string;
  home: boolean;
  started: boolean;
  minutes: number;
  stats: Record<string, number>;
}

export interface TeamGameLog {
  teamId: string;
  gameId: string;
  sport: SportId;
  season: string;
  date: string;
  opponentId: string;
  home: boolean;
  scoreFor: number;
  scoreAgainst: number;
  result: "W" | "L" | "D";
  /** Box score produced by this team. */
  box: Record<string, number>;
  /** Box score this team allowed (opponent's box). */
  allowed: Record<string, number>;
}

export interface DataSourceInfo {
  id: string;
  name: string;
  kind: "demo" | "live";
  description: string;
  lastUpdated: string;
}
