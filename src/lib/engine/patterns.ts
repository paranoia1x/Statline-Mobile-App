import { SPORTS, statDef } from "@/lib/sports";
import type { Player, PlayerGameLog, TeamGameLog } from "@/lib/types";
import { mean, sd, slope, welchT } from "./math";

export interface Pattern {
  kind: "role" | "form" | "venue" | "trend" | "opponent" | "streak";
  title: string;
  detail: string;
  direction: "up" | "down" | "neutral";
  /** |t| or comparable strength; only patterns passing a significance bar are reported. */
  strength: number;
  statKey?: string;
}

/**
 * Historical pattern detection. Reports only differences that clear a
 * statistical bar (|t| >= 2) so ordinary game-to-game noise is not presented
 * as a trend. Streaks are surfaced as context, never as a predictive signal.
 */
export function detectPlayerPatterns(player: Player, logs: PlayerGameLog[]): Pattern[] {
  const out: Pattern[] = [];
  const sport = SPORTS[player.sport];
  if (logs.length < 12) return out;
  const mins = logs.map((l) => l.minutes);
  const tMin = welchT(mins.slice(-5), mins.slice(-25, -5));
  const r = mean(mins.slice(-5)) / mean(mins.slice(-25, -5));
  if (Math.abs(tMin) >= 2 && Math.abs(r - 1) > 0.1)
    out.push({
      kind: "role",
      title: `${sport.playingTimeLabel} ${r > 1 ? "increase" : "decrease"}`,
      detail: `${mean(mins.slice(-5)).toFixed(1)} over the last 5 games vs ${mean(mins.slice(-25, -5)).toFixed(1)} in the prior 20.`,
      direction: r > 1 ? "up" : "down",
      strength: Math.abs(tMin),
    });

  const keys = sport.headline[player.positionGroup] ?? [];
  const season = logs[logs.length - 1].season;
  for (const key of keys) {
    const def = statDef(player.sport, key);
    if (!def || def.ratio) continue;
    const vals = logs.map((l) => l.stats[key]).filter((v): v is number => typeof v === "number");
    if (vals.length < 15) continue;
    const seasonVals = logs.filter((l) => l.season === season).map((l) => l.stats[key]).filter((v): v is number => typeof v === "number");
    const last10 = vals.slice(-10);
    const rest = seasonVals.length > 15 ? seasonVals.slice(0, -10) : vals.slice(-40, -10);
    const t = welchT(last10, rest);
    if (Math.abs(t) >= 2) {
      out.push({
        kind: "form",
        title: `${def.label} ${t > 0 ? "above" : "below"} baseline`,
        detail: `${mean(last10).toFixed(1)} per game over the last 10 vs ${mean(rest).toFixed(1)} earlier (t = ${t.toFixed(1)}).`,
        direction: t > 0 ? "up" : "down",
        strength: Math.abs(t),
        statKey: key,
      });
    }
    const home = logs.filter((l) => l.home).map((l) => l.stats[key]).filter((v): v is number => typeof v === "number");
    const away = logs.filter((l) => !l.home).map((l) => l.stats[key]).filter((v): v is number => typeof v === "number");
    const tv = welchT(home, away);
    if (Math.abs(tv) >= 2.2 && home.length >= 10 && away.length >= 10)
      out.push({
        kind: "venue",
        title: `${def.label}: ${tv > 0 ? "stronger at home" : "stronger on the road"}`,
        detail: `Home ${mean(home).toFixed(1)} (${home.length} g) vs away ${mean(away).toFixed(1)} (${away.length} g).`,
        direction: "neutral",
        strength: Math.abs(tv),
        statKey: key,
      });
    const last20 = vals.slice(-20);
    const s = slope(last20);
    const sigma = sd(last20);
    if (sigma > 0 && Math.abs((s * 19) / sigma) > 1.2)
      out.push({
        kind: "trend",
        title: `${def.label} trending ${s > 0 ? "up" : "down"}`,
        detail: `Linear trend of ${s > 0 ? "+" : ""}${s.toFixed(2)} per game across the last 20 games.`,
        direction: s > 0 ? "up" : "down",
        strength: Math.abs((s * 19) / sigma),
        statKey: key,
      });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

export function teamFormNotes(logs: TeamGameLog[]): string[] {
  if (logs.length < 10) return [];
  const notes: string[] = [];
  const last = logs.slice(-10);
  const prev = logs.slice(-30, -10);
  const t = welchT(last.map((l) => l.scoreFor - l.scoreAgainst), prev.map((l) => l.scoreFor - l.scoreAgainst));
  if (Math.abs(t) >= 2)
    notes.push(
      `Point differential over the last 10 (${fmtSigned(mean(last.map((l) => l.scoreFor - l.scoreAgainst)))}) differs notably from the prior 20 (${fmtSigned(mean(prev.map((l) => l.scoreFor - l.scoreAgainst)))}).`,
    );
  let streak = 1;
  const r = logs[logs.length - 1].result;
  for (let i = logs.length - 2; i >= 0 && logs[i].result === r; i--) streak++;
  if (streak >= 4)
    notes.push(`Current ${r === "W" ? "winning" : r === "L" ? "losing" : "drawing"} streak: ${streak}. Shown for context only — streaks are not used to predict the next result.`);
  return notes;
}

const fmtSigned = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
