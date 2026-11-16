import { SPORT_IDS } from "@/lib/types";
import { fail, json, readJson } from "@/lib/server/http";

export async function PATCH(req: Request) {
  const b = await readJson<{ defaultSport?: string }>(req);
  const s = b?.defaultSport;
  if (s !== "all" && !(SPORT_IDS as string[]).includes(s ?? "")) return fail("Invalid sport");
  localStorage.setItem("sl.sport", s === "all" ? "" : s!);
  window.dispatchEvent(new Event("sport-change"));
  return json({ ok: true });
}
