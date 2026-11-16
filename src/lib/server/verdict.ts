import { narrate, type NarrativeResult } from "@/lib/ai/narrate";
import { getTrackRecord } from "@/lib/engine/evaluation";
import type { PlayerForecast } from "@/lib/engine/player-forecast";
import { buildVerdict, verdictTemplate, type TrackRecord, type Verdict } from "@/lib/engine/verdict";
import type { SportId } from "@/lib/types";

const GUIDANCE =
  "Open with the verdict label in plain words (for example 'Lean hit' or 'Toss-up') and the hit probability. " +
  "Then give the strongest reason for a hit and the strongest reason for a miss, then the backtest track record for this strength if provided. " +
  "Say it is a probability, not a guarantee. Never tell the reader to bet or act on it.";

/** Hit/miss verdict for a side of the threshold, plus an AI (or template) explanation. */
export async function verdictFor(
  f: PlayerForecast,
  sport: SportId,
  playerName: string,
  opponentName: string,
  side: "over" | "under" | null,
  demo: boolean,
): Promise<{ verdict: Verdict; narrative: NarrativeResult; trackRecord: TrackRecord | null }> {
  const trackRecord = await getTrackRecord(sport);
  const verdict = buildVerdict(f, playerName, side, trackRecord);
  const narrative = await narrate(
    "hit-or-miss verdict",
    {
      player: playerName,
      opponent: opponentName,
      statistic: f.statLabel,
      threshold: f.threshold,
      side: verdict.side === "over" ? "above the threshold" : "below the threshold",
      verdict: verdict.label,
      probabilityHit: +verdict.pHit.toFixed(3),
      probabilityMiss: +verdict.pMiss.toFixed(3),
      projection: +f.projection.toFixed(2),
      confidence: f.confidence,
      reasonsForHit: verdict.forHit,
      reasonsAgainstHit: verdict.againstHit,
      backtestTrackRecord: verdict.trackRecord
        ? { strength: verdict.strength, rightRate: verdict.trackRecord.rate == null ? null : +verdict.trackRecord.rate.toFixed(3), games: verdict.trackRecord.n }
        : null,
      warnings: f.warnings,
      dataIsDemo: demo,
    },
    verdictTemplate(verdict, playerName, opponentName, demo),
    GUIDANCE,
  );
  return { verdict, narrative, trackRecord };
}
