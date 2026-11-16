import { NextResponse } from "next/server";
import { gradePendingForUser } from "@/lib/server/grading";
import { json, requireUser } from "@/lib/server/http";

export async function POST() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  return json({ graded: await gradePendingForUser(u.id) });
}
