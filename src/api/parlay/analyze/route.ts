import { analyzeParlay, type LegInput } from "@/lib/server/parlay";
import { fail, handle, json, readJson } from "@/lib/server/http";

/** POST { legs: [{ leg, odds }], parlayOdds } — probability of each leg and of the whole parlay. */
export async function POST(req: Request) {
  const b = await readJson<{ legs?: LegInput[]; parlayOdds?: number | null }>(req);
  const legs = Array.isArray(b?.legs) ? b!.legs!.slice(0, 15) : [];
  if (!legs.length) return fail("Add at least one leg");
  for (const l of legs) {
    const g = l?.leg as Record<string, unknown> | undefined;
    if (!g?.kind) return fail("Each leg needs a type");
    if (g.kind === "player" && (!g.playerId || !g.statKey || typeof g.line !== "number" || (g.side !== "over" && g.side !== "under")))
      return fail("Player legs need a player, statistic, line and Over/Under");
    if (g.kind !== "player" && !g.teamId) return fail("Team legs need a team");
    if ((g.kind === "spread" || g.kind === "total") && typeof g.line !== "number") return fail("Spread and total legs need a line");
    if (g.kind === "total" && g.side !== "over" && g.side !== "under") return fail("Total legs need Over or Under");
  }
  const odds = typeof b?.parlayOdds === "number" && Math.abs(b.parlayOdds) >= 100 ? b.parlayOdds : null;
  try {
    return json(await analyzeParlay(legs, odds));
  } catch (e) {
    return handle(e);
  }
}
