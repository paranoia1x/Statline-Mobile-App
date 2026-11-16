import { getStore } from "@/lib/store";
import { fail, json } from "@/lib/server/http";

/** Returns an object URL for a stored screenshot. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = await getStore().getUploadUrl((await params).id);
  return url ? json({ url }) : fail("Not found", 404);
}
