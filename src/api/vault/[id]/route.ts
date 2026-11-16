import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { fail, json, readJson, requireUser } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const item = await getStore().getVaultItem((await params).id, u.id);
  return item ? json({ item }) : fail("Not found", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const b = await readJson<{ title?: string; notes?: string; tags?: string[] }>(req);
  if (!b) return fail("Invalid body");
  const patch: { title?: string; notes?: string; tags?: string[] } = {};
  if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim().slice(0, 200);
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 20_000);
  if (Array.isArray(b.tags)) patch.tags = b.tags.slice(0, 12).map((t) => String(t).trim().slice(0, 40)).filter(Boolean);
  const item = await getStore().updateVaultItem((await params).id, u.id, patch);
  return item ? json({ item }) : fail("Not found", 404);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const ok = await getStore().deleteVaultItem((await params).id, u.id);
  return ok ? json({ ok: true }) : fail("Not found", 404);
}
