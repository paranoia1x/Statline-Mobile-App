import { NextResponse } from "next/server";
import { getCurrentUser, type PublicUser } from "@/lib/auth";
import { ForecastError } from "@/lib/engine/service";

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function requireUser(): Promise<PublicUser | NextResponse> {
  const u = await getCurrentUser();
  return u ?? fail("Sign in required", 401);
}

export function handle(err: unknown) {
  if (err instanceof ForecastError) return fail(err.message, err.status);
  console.error(err);
  return fail("Unexpected server error", 500);
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
