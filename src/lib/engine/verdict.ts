/**
 * Hit-or-miss verdict.
 *
 * Turns a calibrated forecast probability into a plain-language call for a
 * chosen side of a hypothetical threshold ("above 19.5 points"). Pure module
 * (types only) so it can run on the server and in the browser.
 *
 * Strength bands are applied to the calibrated probability of the side being
 * judged, then downgraded one step when the forecast's confidence is low, so
 * a strong-looking number built on thin or unreliable data is never called
 * "Likely".
 */
import type { PlayerForecast } from "./player-forecast";

export type Strength = "likely" | "lean" | "tossup";
export type VerdictLabel = "Likely hit" | "Lean hit" | "Toss-up" | "Lean miss" | "Likely miss";

export const STRENGTH_BANDS = { likely: 0.62, lean: 0.54 } as const;

/** Strength of the favoured side, given its probability (>= 0.5) and the forecast confidence. */
export function strengthOf(pFavoured: number, confidence: "low" | "medium" | "high"): Strength {
  let s: Strength = pFavoured >= STRENGTH_BANDS.likely ? "likely" : pFavoured >= STRENGTH_BANDS.lean ? "lean" : "tossup";
  if (confidence === "low" && s === "likely") s = "lean";
  return s;
}

export function labelFor(pHit: number, confidence: "low" | "medium" | "high"): VerdictLabel {
  const favHit = pHit >= 0.5;
  const s = strengthOf(favHit ? pHit : 1 - pHit, confidence);
  if (s === "tossup") return "Toss-up";
  return `${s === "likely" ? "Likely" : "Lean"} ${favHit ? "hit" : "miss"}` as VerdictLabel;
}

export interface TrackRecord {
  /** How often the favoured side actually happened, by strength, in the walk-forward backtest. */
  likely: { n: number; rate: number | null };
  lean: { n: number; rate: number | null };
  tossup: { n: number; rate: number | null };
}

export interface Verdict {
  side: "over" | "under";
  sideSource: "user" | "default";
  threshold: number;
  statLabel: string;
  pHit: number;
  pMiss: number;
  pPush: number;
  label: VerdictLabel;
  strength: Strength;
  tone: "pos" | "neg" | "neutral";
  headline: string;
  forHit: string[];
  againstHit: string[];
  caveats: string[];
  trackRecord: { strength: Strength; n: number; rate: number | null } | null;
}

export function buildVerdict(
  f: PlayerForecast,
  playerName: string,
  side?: "over" | "under" | null,
  track?: TrackRecord | null,
): Verdict {
  // "hit" means clearing the threshold unless the user picked the under side
  const chosen: "over" | "under" = side ?? "over";
  const pHit = chosen === "over" ? f.pOver : f.pUnder;
  const pMiss = chosen === "over" ? f.pUnder : f.pOver;
  const decided = Math.max(1e-9, pHit + pMiss);
  const pHitDecided = pHit / decided; // pushes neither hit nor miss
  const label = labelFor(pHitDecided, f.confidence.level);
  const strength = strengthOf(Math.max(pHitDecided, 1 - pHitDecided), f.confidence.level);
  const dir = chosen === "over" ? "above" : "below";
  const verb = label.endsWith("hit") ? "favours" : label.endsWith("miss") ? "is against" : "is split on";

  // evidence pointing toward / away from the chosen side
  const all = [...f.supporting, ...f.conflicting];
  const forHit = all.filter((e) => e.direction === chosen).sort((a, b) => b.weight - a.weight).map((e) => e.text);
  const againstHit = all.filter((e) => e.direction !== chosen && e.direction !== "neutral").sort((a, b) => b.weight - a.weight).map((e) => e.text);

  const caveats: string[] = [];
  if (f.warnings.some((w) => /\bOUT\b/.test(w))) caveats.push("The player is listed out — if they don't play, the result is void.");
  if (f.confidence.level === "low") caveats.push(`Low confidence (${f.confidence.reasons.join(", ")}), so this call is capped at "Lean".`);
  if (f.pPush > 0.01) caveats.push(`${(f.pPush * 100).toFixed(1)}% chance of landing exactly on ${f.threshold} (neither hit nor miss).`);
  caveats.push("A statistical estimate for research — not a guarantee or wagering advice.");

  const tr = track ? track[strength] : null;
  return {
    side: chosen,
    sideSource: side ? "user" : "default",
    threshold: f.threshold,
    statLabel: f.statLabel,
    pHit,
    pMiss,
    pPush: f.pPush,
    label,
    strength,
    tone: label.endsWith("hit") ? "pos" : label.endsWith("miss") ? "neg" : "neutral",
    headline: `${(pHit * 100).toFixed(1)}% chance ${playerName} finishes ${dir} ${f.threshold} ${f.statLabel.toLowerCase()} — the model ${verb} it.`,
    forHit: forHit.slice(0, 4),
    againstHit: againstHit.slice(0, 4),
    caveats,
    trackRecord: tr ? { strength, n: tr.n, rate: tr.rate } : null,
  };
}

export function verdictTemplate(v: Verdict, playerName: string, opponentName: string, demo: boolean) {
  const dir = v.side === "over" ? "above" : "below";
  const call =
    v.label === "Toss-up"
      ? `it's essentially a toss-up whether ${playerName} finishes ${dir} ${v.threshold}`
      : `${v.label.toLowerCase()}: ${playerName} finishing ${dir} ${v.threshold} ${v.statLabel.toLowerCase()} against ${opponentName}`;
  const text = [
    `${demo ? "Using demo data, the" : "The"} model's call is ${call}, with an estimated ${(v.pHit * 100).toFixed(1)}% chance of hitting and ${(v.pMiss * 100).toFixed(1)}% of missing.`,
    v.forHit[0] ? `Best case for a hit: ${lowerFirst(v.forHit[0])}` : "",
    v.againstHit[0] ? `Main risk: ${lowerFirst(v.againstHit[0])}` : "",
    v.trackRecord && v.trackRecord.rate != null
      ? `In backtesting, "${v.strength === "tossup" ? "Toss-up" : v.strength === "likely" ? "Likely" : "Lean"}" calls were right ${(v.trackRecord.rate * 100).toFixed(0)}% of the time (${v.trackRecord.n} games).`
      : "",
    "This is a probability, not a guarantee.",
  ]
    .filter(Boolean)
    .join(" ");
  return text;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
