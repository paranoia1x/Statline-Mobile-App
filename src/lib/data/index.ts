import type { SportsDataProvider } from "./provider";
import type { SportId } from "@/lib/types";
import { SPORTS } from "@/lib/sports";

/**
 * The active data provider. In the app it is the SnapshotProvider (set in src/main.tsx);
 * the data job sets the ESPN provider while building snapshots.
 */
let provider: SportsDataProvider | null = null;

export function setProvider(p: SportsDataProvider) {
  provider = p;
}

export function getProvider(): SportsDataProvider {
  if (!provider) throw new Error("Data provider not initialised");
  return provider;
}

/** Forecastable stats for a sport/position that the active provider can actually supply. */
export function supportedStatKeys(sport: SportId, keys: string[]) {
  const bad = new Set(getProvider().unsupportedStats?.(sport) ?? []);
  return keys.filter((k) => !bad.has(k));
}

/** Stat definitions for a sport/position group, minus those the active provider cannot supply. */
export function visibleStats(sport: SportId, group?: string) {
  const bad = new Set(getProvider().unsupportedStats?.(sport) ?? []);
  return SPORTS[sport].stats.filter((s) => !bad.has(s.key) && (!group || s.groups.includes(group)));
}
