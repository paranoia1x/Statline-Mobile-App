import { getProvider } from "@/lib/data";
import { playerVM, teamVM, type GameVM, type PlayerVM, type TeamVM } from "@/lib/view";
import type { Game, Injury, Player, SportId, Team } from "@/lib/types";

export async function teamMap(sport?: SportId | null): Promise<Map<string, Team>> {
  const teams = await getProvider().listTeams(sport ?? undefined);
  return new Map(teams.map((t) => [t.id, t]));
}

export async function injuryMap(sport?: SportId | null): Promise<Map<string, Injury>> {
  const inj = await getProvider().getInjuries(sport ?? undefined);
  return new Map(inj.map((i) => [i.playerId, i]));
}

export function gameVM(g: Game, teams: Map<string, Team>): GameVM {
  return {
    id: g.id, sport: g.sport, date: g.date, status: g.status, venue: g.venue,
    home: teamVM(teams.get(g.homeTeamId)!), away: teamVM(teams.get(g.awayTeamId)!), homeScore: g.homeScore, awayScore: g.awayScore,
  };
}

export async function playersVM(players: Player[]): Promise<PlayerVM[]> {
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  return players.map((p) => playerVM(p, teams.get(p.teamId), inj.get(p.id)));
}

export async function teamVMById(id: string): Promise<TeamVM | null> {
  const t = await getProvider().getTeam(id);
  return t ? teamVM(t) : null;
}
