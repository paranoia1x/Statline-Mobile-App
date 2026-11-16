import { buildResearchReport, type ScenarioInput } from "@/lib/engine/report";
import { fail, handle, json, readJson } from "@/lib/server/http";

/** POST { scenarios: ScenarioInput[] } -> independent research report per confirmed scenario. */
export async function POST(req: Request) {
  const b = await readJson<{ scenarios?: ScenarioInput[] }>(req);
  const list = Array.isArray(b?.scenarios) ? b!.scenarios!.slice(0, 10) : [];
  if (!list.length) return fail("Confirm at least one scenario");
  const results = [];
  for (const s of list) {
    if (!s?.playerId || !s.statKey || s.threshold == null || !Number.isFinite(Number(s.threshold))) {
      results.push({ ok: false, error: "Player, statistic and threshold are required", input: s });
      continue;
    }
    try {
      const report = await buildResearchReport({ ...s, threshold: Number(s.threshold) });
      results.push({ ok: true, report });
    } catch (e) {
      const r = handle(e);
      const body = await r.json();
      results.push({ ok: false, error: body.error, input: s });
    }
  }
  return json({ results });
}
