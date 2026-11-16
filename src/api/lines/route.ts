import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { activeLines } from "@/lib/lines";
import { json, requireUser } from "@/lib/server/http";
import { SPORT_IDS, type SportId } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/lines?sport= — active PrizePicks lines (imported + optional live feed). */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  const sp = new URL(req.url).searchParams.get("sport");
  const sport = sp && (SPORT_IDS as string[]).includes(sp) ? (sp as SportId) : null;
  return json({ lines: await activeLines(u?.id ?? null, sport), feedConfigured: false, signedIn: !!u });
}

/** DELETE /api/lines — clear the user's imported lines. */
export async function DELETE() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  return json({ deleted: await getStore().deleteLines(u.id) });
}
