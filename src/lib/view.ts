/**
 * Serializable view models passed from server components to client
 * components. Image URLs are resolved server-side through the image system.
 */
import { playerImageUrl, teamLogoUrl } from "@/lib/images";
import type { Game, Injury, Player, SportId, Team } from "@/lib/types";

export interface TeamVM {
  id: string;
  sport: SportId;
  name: string;
  fullName: string;
  city: string;
  abbreviation: string;
  colors: { primary: string; secondary: string };
  logoUrl: string | null;
}
export interface PlayerVM {
  id: string;
  sport: SportId;
  name: string;
  firstName: string;
  lastName: string;
  position: string;
  positionGroup: string;
  jersey: number;
  teamId: string;
  imageUrl: string | null;
  team?: TeamVM;
  injury?: Pick<Injury, "status" | "description" | "seasonEnding" | "expectedReturn" | "note"> | null;
}

export const teamVM = (t: Team): TeamVM => ({
  id: t.id, sport: t.sport, name: t.name, fullName: t.fullName, city: t.city, abbreviation: t.abbreviation, colors: t.colors, logoUrl: teamLogoUrl(t),
});

export const playerVM = (p: Player, team?: Team | null, injury?: Injury | null): PlayerVM => ({
  id: p.id, sport: p.sport, name: p.name, firstName: p.firstName, lastName: p.lastName, position: p.position, positionGroup: p.positionGroup,
  jersey: p.jersey, teamId: p.teamId, imageUrl: playerImageUrl(p), team: team ? teamVM(team) : undefined,
  injury: injury ? { status: injury.status, description: injury.description, seasonEnding: !!injury.seasonEnding, expectedReturn: injury.expectedReturn ?? null, note: injury.note ?? null } : null,
});

export interface GameVM {
  id: string;
  sport: SportId;
  date: string;
  status: Game["status"];
  home: TeamVM;
  away: TeamVM;
  homeScore: number | null;
  awayScore: number | null;
  venue: string;
}
