import { NextResponse } from "next/server";
import { importLinesFromText } from "@/lib/lines";
import { fail, json, readJson, requireUser } from "@/lib/server/http";

/** POST { text } — import a pasted or OCR'd PrizePicks board as reference lines. */
export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const b = await readJson<{ text?: string }>(req);
  const text = b?.text?.slice(0, 50_000) ?? "";
  if (!text.trim()) return fail("Paste your PrizePicks board or upload a screenshot first");
  return json(await importLinesFromText(u.id, text));
}
