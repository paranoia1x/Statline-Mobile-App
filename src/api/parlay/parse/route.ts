import { getProvider } from "@/lib/data";
import { parseSlip } from "@/lib/parse/parlay";
import type { Team } from "@/lib/types";
import { fail, json, readJson } from "@/lib/server/http";

/** POST { text } — extract parlay legs (player props + team legs) from a pasted or OCR'd bet slip. */
export async function POST(req: Request) {
  const b = await readJson<{ text?: string }>(req);
  const text = b?.text?.slice(0, 30_000) ?? "";
  if (!text.trim()) return fail("Paste your bet slip or upload a screenshot first");
  const p = getProvider();
  const [players, teams] = await Promise.all([p.listPlayers(), p.listTeams()]);
  // shared nicknames (e.g. "Kings"): prefer the team that plays soonest
  const now = p.now().getTime();
  const soon = await p.listGames({ from: new Date(now - 6 * 3_600_000).toISOString(), to: new Date(now + 3 * 86_400_000).toISOString(), status: "scheduled" });
  const firstGame = (t: Team) => soon.find((g) => g.homeTeamId === t.id || g.awayTeamId === t.id)?.date ?? "9999";
  const prefer = (cands: Team[]) => [...cands].sort((a, b) => firstGame(a).localeCompare(firstGame(b)))[0];
  return json(parseSlip(text, { players, teams }, p.now(), prefer));
}
