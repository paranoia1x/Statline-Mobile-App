import type { Player, Team } from "@/lib/types";

/**
 * Image URLs in the app. The data job publishes only *verified* ESPN headshots and logos
 * (a headshot is verified when it was published on the player's current team roster);
 * anything else shows a neutral placeholder — never a substitute photo.
 */
const players = new Map<string, string>();
const teams = new Map<string, string>();

export function setImageMaps(m: { players: Record<string, string>; teams: Record<string, string> }) {
  for (const [k, v] of Object.entries(m.players)) players.set(k, v);
  for (const [k, v] of Object.entries(m.teams)) teams.set(k, v);
}

export const playerImageUrl = (p: Pick<Player, "id">) => players.get(p.id) ?? null;
export const teamLogoUrl = (t: Pick<Team, "id">) => teams.get(t.id) ?? null;
