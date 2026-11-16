import type { PlaysFile } from "@/boot";
import type { Play } from "@/lib/server/top-plays";
import { SPORT_IDS, type SportId } from "@/lib/types";

const LIMIT = 12;

/**
 * Upcoming plays for a sport filter. The data job computes each sport separately; "All"
 * applies the desktop's rule (at most half of the plays from one sport) to those lists,
 * which gives the same result as computing across all sports at once.
 */
export function upcomingPlays(file: PlaysFile, sport: SportId | null, now = Date.now()): Play[] {
  const fresh = (p: Play) => Date.parse(p.gameDate) > now;
  if (sport) return (file.sports[sport]?.upcoming ?? []).filter(fresh);
  const cap = Math.ceil(LIMIT / 2);
  const per = new Map<string, number>();
  const out: Play[] = [];
  const all = SPORT_IDS.flatMap((s) => file.sports[s]?.upcoming ?? []).filter(fresh).sort((a, b) => b.probability - a.probability);
  for (const p of all) {
    if ((per.get(p.sport) ?? 0) >= cap) continue;
    per.set(p.sport, (per.get(p.sport) ?? 0) + 1);
    out.push(p);
    if (out.length >= LIMIT) break;
  }
  return out;
}

/** Recent graded days (most recent first) for a sport filter. */
export function recentPlays(file: PlaysFile, sport: SportId | null): { day: string; plays: Play[] }[] {
  const days = new Map<string, Play[]>();
  for (const s of sport ? [sport] : SPORT_IDS)
    for (const d of file.sports[s]?.recent ?? []) days.set(d.day, [...(days.get(d.day) ?? []), ...d.plays]);
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, plays]) => ({ day, plays: sport ? plays : plays.sort((a, b) => b.probability - a.probability).slice(0, LIMIT) }));
}

export function considered(file: PlaysFile, sport: SportId | null) {
  return (sport ? [sport] : SPORT_IDS).reduce((a, s) => a + (file.sports[s]?.considered ?? 0), 0);
}
