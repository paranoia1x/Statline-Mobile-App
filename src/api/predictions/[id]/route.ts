import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { fail, json, readJson, requireUser } from "@/lib/server/http";

/** Only notes can be edited; results come exclusively from grading. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const { id } = await params;
  const b = await readJson<{ note?: string }>(req);
  const updated = await getStore().updatePrediction(id, u.id, { note: (b?.note ?? "").slice(0, 500) });
  return updated ? json({ prediction: updated }) : fail("Not found", 404);
}

/** Pending predictions can be withdrawn; graded ones are permanent so results are never hidden. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const { id } = await params;
  const store = getStore();
  const pred = (await store.listPredictions(u.id)).find((p) => p.id === id);
  if (!pred) return fail("Not found", 404);
  if (pred.status !== "pending") return fail("Graded predictions cannot be deleted — the tracker never hides results.", 409);
  await store.deletePrediction(id, u.id);
  return json({ ok: true });
}
