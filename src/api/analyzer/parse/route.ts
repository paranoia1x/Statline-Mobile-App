import { getProvider } from "@/lib/data";
import { parseScenarios } from "@/lib/parse/pick";
import { fail, json, readJson } from "@/lib/server/http";

/** POST { text } -> extracted scenarios (pasted text or OCR output) for user confirmation. */
export async function POST(req: Request) {
  const b = await readJson<{ text?: string }>(req);
  const text = b?.text?.slice(0, 20_000) ?? "";
  if (!text.trim()) return fail("Paste some text or upload a screenshot first");
  const p = getProvider();
  const [players, teams] = await Promise.all([p.listPlayers(), p.listTeams()]);
  const scenarios = parseScenarios(text, { players, teams }, p.now());
  return json({ scenarios });
}
