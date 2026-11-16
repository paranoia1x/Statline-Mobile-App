"use client";

import { useMemo, useState } from "react";
import type { PlayerForecast } from "@/lib/engine/player-forecast";
import { buildVerdict, STRENGTH_BANDS, verdictTemplate, type TrackRecord, type Verdict } from "@/lib/engine/verdict";
import { cx } from "@/lib/format";

const ZONES = [
  { label: "Likely miss", from: 0, to: 1 - STRENGTH_BANDS.likely, cls: "bg-neg/70" },
  { label: "Lean miss", from: 1 - STRENGTH_BANDS.likely, to: 1 - STRENGTH_BANDS.lean, cls: "bg-neg/35" },
  { label: "Toss-up", from: 1 - STRENGTH_BANDS.lean, to: STRENGTH_BANDS.lean, cls: "bg-ink-600" },
  { label: "Lean hit", from: STRENGTH_BANDS.lean, to: STRENGTH_BANDS.likely, cls: "bg-pos/35" },
  { label: "Likely hit", from: STRENGTH_BANDS.likely, to: 1, cls: "bg-pos/70" },
];

/**
 * "Will it hit?" card. Shows the model's call for one side of the threshold,
 * where the hit probability sits on the verdict scale, the reasons on each
 * side, and how often calls of this strength were right in backtesting.
 */
export function VerdictCard({
  forecast,
  playerName,
  opponentName,
  initial,
  narrative,
  trackRecord,
  demo,
  allowToggle = true,
  pickem = false,
}: {
  forecast: PlayerForecast;
  playerName: string;
  opponentName: string;
  initial: Verdict;
  narrative: { text: string; source: "claude" | "template" };
  trackRecord: TrackRecord | null;
  demo: boolean;
  allowToggle?: boolean;
  /** Use PrizePicks wording (More / Less) for the two sides. */
  pickem?: boolean;
}) {
  const word = (s: "over" | "under") => (pickem ? (s === "over" ? "More" : "Less") : s === "over" ? "Above" : "Below");
  const [side, setSide] = useState<"over" | "under">(initial.side);
  const v = useMemo(
    () => (side === initial.side ? initial : buildVerdict(forecast, playerName, side, trackRecord)),
    [side, initial, forecast, playerName, trackRecord],
  );
  const text = side === initial.side ? narrative : { text: verdictTemplate(v, playerName, opponentName, demo), source: "template" as const };
  const decided = v.pHit / Math.max(1e-9, v.pHit + v.pMiss);
  const color = v.tone === "pos" ? "text-pos" : v.tone === "neg" ? "text-neg" : "text-ink-200";
  const border = v.tone === "pos" ? "border-pos/40" : v.tone === "neg" ? "border-neg/40" : "border-ink-600";

  return (
    <section className={cx("rounded-xl border bg-ink-900 p-4 sm:p-5", border)} aria-label="AI hit-or-miss verdict">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-ai/40 bg-ai/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-light">
              <span className="h-1.5 w-1.5 rounded-full bg-ai" aria-hidden />
              AI verdict
            </span>
            <span className="text-xs text-ink-400">
              {pickem ? `${word(v.side)} than ${v.threshold} ${v.statLabel.toLowerCase()} for ${playerName}?` : `Will ${playerName} finish ${v.side === "over" ? "above" : "below"} ${v.threshold} ${v.statLabel.toLowerCase()}?`}
              {v.sideSource === "user" && side === initial.side ? " (your side)" : ""}
            </span>
          </div>
          <div className={cx("text-3xl font-bold uppercase tracking-tight sm:text-4xl", color)}>{v.label}</div>
          <p className="mt-1 text-sm text-ink-200">
            <span className="num font-semibold text-white">{(v.pHit * 100).toFixed(1)}%</span> chance to hit ·{" "}
            <span className="num">{(v.pMiss * 100).toFixed(1)}%</span> to miss
            {v.pPush > 0.001 && <span className="text-ink-400"> · {(v.pPush * 100).toFixed(1)}% exactly {v.threshold}</span>}
          </p>
        </div>
        {allowToggle && (
          <div className="flex shrink-0 gap-1" role="tablist" aria-label="Side of the threshold">
            {(["over", "under"] as const).map((s) => (
              <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)} className={cx("chip", side === s && "chip-active")}>
                {word(s)} {v.threshold}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* verdict scale */}
      <div className="mt-5">
        <div className="relative">
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
            {ZONES.map((z) => (
              <div key={z.label} className={z.cls} style={{ width: `${(z.to - z.from) * 100}%` }} title={z.label} />
            ))}
          </div>
          <div className="absolute -top-1.5 h-5 w-1 -translate-x-1/2 rounded bg-white shadow" style={{ left: `${Math.min(99, Math.max(1, decided * 100))}%` }} aria-hidden />
        </div>
        <div
          className="mt-1.5 grid text-center text-[10px] uppercase tracking-wider text-ink-500"
          style={{ gridTemplateColumns: ZONES.map((z) => `${(z.to - z.from) * 100}fr`).join(" ") }}
        >
          {ZONES.map((z) => (
            <span key={z.label} className={cx("truncate px-0.5", z.label === v.label && "font-semibold text-ink-100")}>
              {z.to - z.from < 0.1 ? (z.label === "Toss-up" ? "50/50" : z.label.split(" ")[0]) : z.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <div className="label mb-1.5 text-pos">Why it could hit</div>
          {v.forHit.length ? (
            <ul className="space-y-1 text-sm text-ink-300">{v.forHit.map((t) => <li key={t}>+ {t}</li>)}</ul>
          ) : (
            <div className="text-sm text-ink-500">No supporting signals.</div>
          )}
        </div>
        <div>
          <div className="label mb-1.5 text-neg">Why it could miss</div>
          {v.againstHit.length ? (
            <ul className="space-y-1 text-sm text-ink-300">{v.againstHit.map((t) => <li key={t}>− {t}</li>)}</ul>
          ) : (
            <div className="text-sm text-ink-500">No opposing signals.</div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ai/25 bg-ai/[0.05] p-3 text-sm leading-relaxed text-ink-200">
        {text.text}
        <div className="mt-1 text-[11px] text-ink-500">{text.source === "claude" ? "Written by Claude from the computed statistics" : "Generated from the computed statistics"}</div>
      </div>

      <div className="mt-3 flex flex-col gap-1 text-[11px] text-ink-400">
        {v.trackRecord && v.trackRecord.rate != null && (
          <span>
            Track record: in walk-forward backtesting, &ldquo;{v.strength === "likely" ? "Likely" : v.strength === "lean" ? "Lean" : "Toss-up"}&rdquo; calls were right{" "}
            <span className="num text-ink-200">{(v.trackRecord.rate * 100).toFixed(0)}%</span> of the time ({v.trackRecord.n.toLocaleString()} games).
          </span>
        )}
        {v.caveats.map((c) => (
          <span key={c}>• {c}</span>
        ))}
      </div>
    </section>
  );
}
