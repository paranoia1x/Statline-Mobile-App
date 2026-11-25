/**
 * App startup: creates the snapshot data provider, loads the stats index and the
 * pre-computed model results, and exposes them to the rest of the app.
 */
import { setProvider } from "@/lib/data";
import { SnapshotProvider } from "@/lib/data/snapshot";
import { setPrecomputedBacktest, type BacktestResult } from "@/lib/engine/evaluation";
import type { Play } from "@/lib/server/top-plays";
import type { FantasyAccuracy } from "@/lib/fantasy/backtest";
import { clearFantasyCache } from "@/lib/fantasy/engine";
import type { SportId } from "@/lib/types";

export const BASE = import.meta.env.BASE_URL;
export const provider = new SnapshotProvider(BASE);
setProvider(provider);

export interface PlaysFile {
  generatedAt: string;
  sports: Partial<Record<SportId, { upcoming: Play[]; considered: number; recent: { day: string; plays: Play[] }[] }>>;
  trackRecord: Record<string, { n: number; rate: number | null }>;
}

let modelP: Promise<BacktestResult[]> | null = null;
let playsP: Promise<PlaysFile> | null = null;
let fantasyP: Promise<FantasyFile> | null = null;

export interface FantasyFile {
  generatedAt: string;
  /** Walk-forward backtest of the fantasy projections, per sport and scoring format. */
  accuracy: FantasyAccuracy[];
}

async function getJson<T>(file: string): Promise<T> {
  const r = await fetch(`${BASE}data/${file}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Couldn't load ${file} (${r.status})`);
  return r.json() as Promise<T>;
}

/** Model backtests (calibration + track records), computed by the data job. */
export function loadModel() {
  return (modelP ??= getJson<{ backtests: BacktestResult[] }>("model.json")
    .then((m) => {
      const list = m.backtests.map((b) => ({ ...b, samples: [] }));
      setPrecomputedBacktest(list);
      return list;
    })
    .catch((e) => {
      modelP = null;
      throw e;
    }));
}

/** Pre-computed Top Plays. */
export function loadPlays() {
  return (playsP ??= getJson<PlaysFile>("plays.json").catch((e) => {
    playsP = null;
    throw e;
  }));
}

/** Fantasy projection accuracy (computed by the data job). Missing on older data → empty. */
export function loadFantasyModel() {
  return (fantasyP ??= getJson<FantasyFile>("fantasy.json").catch(() => {
    fantasyP = null;
    return { generatedAt: "", accuracy: [] };
  }));
}

export async function boot() {
  await Promise.all([provider.loadMeta(), loadModel()]);
}

/** Force fresh stats (pull-to-refresh / Settings → Refresh). */
export function resetCaches() {
  modelP = null;
  playsP = null;
  fantasyP = null;
  clearFantasyCache();
}
