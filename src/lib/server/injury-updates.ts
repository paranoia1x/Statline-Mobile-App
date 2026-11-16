import { getProvider } from "@/lib/data";
import { playerVM } from "@/lib/view";
import type { SportId } from "@/lib/types";
import { teamMap } from "./lookups";

/** Most recent injury-report notes, newest first. */
export async function injuryUpdates(sport: SportId | null, limit = 15) {
  const prov = getProvider();
  const [inj, teams] = await Promise.all([prov.getInjuries(sport ?? undefined), teamMap(sport)]);
  const recent = inj.filter((i) => i.note).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit * 2);
  const rows = [];
  for (const i of recent) {
    const p = await prov.getPlayer(i.playerId);
    if (!p) continue;
    rows.push({ player: playerVM(p, teams.get(p.teamId), i), status: i.status, seasonEnding: !!i.seasonEnding, returns: i.expectedReturn, note: i.note!, updatedAt: i.updatedAt });
    if (rows.length >= limit) break;
  }
  return rows;
}
