import { getProvider } from "@/lib/data";
import { json } from "@/lib/server/http";
import { teamLogoUrl } from "@/lib/images";

/** GET — every team with colours and logo (for the team-colours picker). */
export async function GET() {
  const teams = await getProvider().listTeams();
  return json(
    { teams: teams.map((t) => ({ id: t.id, sport: t.sport, fullName: t.fullName, abbreviation: t.abbreviation, colors: t.colors, logoUrl: teamLogoUrl(t) })) },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
