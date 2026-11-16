import { getProvider } from "@/lib/data";
import { playersVM } from "@/lib/server/lookups";
import { json } from "@/lib/server/http";

/** GET /api/players?ids=a,b,c — lightweight player cards (used for "recently researched"). */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 24);
  const p = getProvider();
  const players = (await Promise.all(ids.map((id) => p.getPlayer(id)))).filter((x): x is NonNullable<typeof x> => !!x);
  return json({ players: await playersVM(players) });
}
