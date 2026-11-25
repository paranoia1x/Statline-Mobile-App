import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal, defensive HTTP client for ESPN's public JSON endpoints.
 * - Only allow-listed ESPN hosts over HTTPS can be requested.
 * - Responses must be JSON and under a size cap; they are parsed, never executed.
 * - Responses are cached on disk (data/espn-cache) with per-request TTLs, and a
 *   stale copy is served if ESPN is unreachable.
 * - Global concurrency limit keeps request volume polite.
 */
export const ESPN_API_HOSTS = new Set(["site.api.espn.com", "site.web.api.espn.com", "sports.core.api.espn.com"]);
export const ESPN_IMAGE_HOSTS = ["a.espncdn.com", "s.espncdn.com"];

const MAX_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = Number(process.env.ESPN_CONCURRENCY || 6);
const cacheDir = path.join(dataDir(), "espn-cache", "http");
const memory = new Map<string, { at: number; body: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

export class EspnError extends Error {}

/** ttlMs = Infinity caches forever; ttlMs <= 0 fetches without caching (callers persist a compact form themselves). */
export async function espnJson<T>(url: string, ttlMs: number, slim?: (body: any) => unknown): Promise<T> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ESPN_API_HOSTS.has(u.hostname)) throw new EspnError(`Host not allowed: ${u.hostname}`);
  const key = crypto.createHash("sha1").update(u.toString() + (slim ? "#slim4" : "")).digest("hex");
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && now - mem.at < ttlMs) return mem.body as T;

  const file = path.join(cacheDir, key.slice(0, 2), key + ".json");
  let stale: { at: number; body: unknown } | null = null;
  try {
    stale = JSON.parse(await fs.promises.readFile(file, "utf8"));
    if (stale && now - stale.at < ttlMs) {
      memory.set(key, stale);
      return stale.body as T;
    }
  } catch {
    /* not cached */
  }

  if (inflight.has(key)) return inflight.get(key) as Promise<T>;
  const p = slot(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(u, { headers: { Accept: "application/json", "User-Agent": "sports-research-app/1.0" }, signal: AbortSignal.timeout(20_000) });
        if (r.status === 404) throw new EspnError(`ESPN 404 for ${u.pathname}`);
        if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
        const type = r.headers.get("content-type") ?? "";
        if (!type.includes("json")) throw new EspnError(`Unexpected content-type ${type}`);
        const text = await r.text();
        if (text.length > MAX_BYTES) throw new EspnError("Response too large");
        const parsed = JSON.parse(text);
        const body = slim ? slim(parsed) : parsed;
        const entry = { at: Date.now(), body };
        if (ttlMs <= 0) return body as T;
        memory.set(key, entry);
        if (memory.size > 2000) memory.delete(memory.keys().next().value!);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, JSON.stringify(entry));
        return body as T;
      } catch (e) {
        lastErr = e;
        if (e instanceof EspnError) break;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    if (stale) return stale.body as T; // serve stale data rather than nothing
    throw lastErr;
  });
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/** Small JSON file store for parsed, compact per-game box scores (completed games never change). */
const boxDir = path.join(dataDir(), "espn-cache", "games");
export async function readBox<T>(sport: string, eventId: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(boxDir, sport, eventId + ".json"), "utf8"));
  } catch {
    return null;
  }
}
export async function writeBox(sport: string, eventId: string, data: unknown) {
  await fs.promises.mkdir(path.join(boxDir, sport), { recursive: true });
  await fs.promises.writeFile(path.join(boxDir, sport, eventId + ".json"), JSON.stringify(data));
}
