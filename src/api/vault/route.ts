import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import type { VaultItem, VaultItemType } from "@/lib/store/types";
import { SPORT_IDS, type SportId } from "@/lib/types";
import { fail, json, readJson, requireUser } from "@/lib/server/http";

const TYPES: VaultItemType[] = ["player", "team", "matchup", "forecast", "report", "screenshot", "note"];

export async function GET() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  return json({ items: await getStore().listVaultItems(u.id) });
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const b = await readJson<Partial<VaultItem>>(req);
  if (!b?.type || !TYPES.includes(b.type)) return fail("Invalid research type");
  if (!b.title?.trim()) return fail("Title is required");
  const sport = b.sport && (SPORT_IDS as string[]).includes(b.sport) ? (b.sport as SportId) : null;
  const payloadSize = JSON.stringify(b.payload ?? null).length;
  if (payloadSize > 400_000) return fail("Research payload too large");
  const item = await getStore().createVaultItem({
    userId: u.id,
    type: b.type,
    sport,
    title: b.title.trim().slice(0, 200),
    refs: {
      playerIds: Array.isArray(b.refs?.playerIds) ? b.refs!.playerIds!.slice(0, 20).map(String) : undefined,
      teamIds: Array.isArray(b.refs?.teamIds) ? b.refs!.teamIds!.slice(0, 20).map(String) : undefined,
      gameId: typeof b.refs?.gameId === "string" ? b.refs.gameId : undefined,
    },
    payload: b.payload ?? null,
    notes: (b.notes ?? "").slice(0, 20_000),
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 12).map((t) => String(t).slice(0, 40)) : [],
    uploadId: typeof b.uploadId === "string" ? b.uploadId : null,
  });
  return json({ item }, 201);
}
