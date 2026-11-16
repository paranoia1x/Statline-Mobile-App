import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { fail, json, requireUser } from "@/lib/server/http";

const MAX = 15 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"];

/** Saves a screenshot on the device (IndexedDB), downscaled. */
export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected multipart form data");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) return fail("No file uploaded");
  if (file.size > MAX) return fail("File exceeds 15 MB limit", 413);
  if (file.type && !TYPES.includes(file.type)) return fail("Only image screenshots are accepted", 415);
  const meta = await getStore().saveUpload(file, ((file as File).name ?? "screenshot").slice(0, 200));
  return json({ upload: meta }, 201);
}
