import { getProvider } from "@/lib/data";
import { teamMap } from "@/lib/server/lookups";
import { teamVM } from "@/lib/view";
import { json } from "@/lib/server/http";
import { SPORT_IDS, type SportId } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/live?sport= — games around today with live state and scores. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams.get("sport");
  const sport = sp && (SPORT_IDS as string[]).includes(sp) ? (sp as SportId) : undefined;
  const prov = getProvider();
  const [games, teams] = await Promise.all([prov.liveGames?.(sport) ?? Promise.resolve([]), teamMap(sport)]);
  return json({
    updatedAt: new Date().toISOString(),
    games: games
      .filter((g) => teams.has(g.homeTeamId) && teams.has(g.awayTeamId))
      .map((g) => ({ ...g, home: teamVM(teams.get(g.homeTeamId)!), away: teamVM(teams.get(g.awayTeamId)!) })),
  });
}
