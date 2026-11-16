"use client";

import { apiFetch } from "@/lib/api";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PlayerAvatar } from "./media";
import { Badge, ConfidencePill, ErrorNote, VerdictBadge } from "./ui";
import { IMAGE_TYPES, ocrImage } from "@/lib/ocr-client";
import { cx, fmtDate, pct } from "@/lib/format";
import type { PlayerVM } from "@/lib/view";

export interface BoardRow {
  player: PlayerVM;
  opponent: string;
  gameId: string | null;
  gameDate: string | null;
  statKey: string;
  statLabel: string;
  line: number;
  origin: "imported" | "feed";
  projection: number | null;
  pOver: number | null;
  pUnder: number | null;
  verdict: { side: "over" | "under"; label: string; p: number } | null;
  confidence: { level: "low" | "medium" | "high"; score: number } | null;
  error: string | null;
}

/**
 * PrizePicks lines board: every active line with the model's probability of
 * going over/under it and the AI verdict, plus an importer for the user's board.
 */
export function LinesPanel({ rows, signedIn, feedConfigured }: { rows: BoardRow[]; signedIn: boolean; feedConfigured: boolean }) {
  const router = useRouter();
  // starts collapsed on phones so the forecast tool stays above the fold
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ saved: number; skipped: { reason: string }[] } | null>(null);
  const [sort, setSort] = useState<"strength" | "player">("strength");
  const fileRef = useRef<HTMLInputElement>(null);

  async function importText(t: string) {
    setBusy("Reading lines…");
    setError(null);
    try {
      const r = await apiFetch("/api/lines/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Import failed");
      setSummary({ saved: d.saved.length, skipped: d.skipped });
      if (d.saved.length) {
        setText("");
        setOpen(false);
        router.refresh();
      } else if (!d.skipped.length) setError("No known players with lines were found. Check the text, or paste the board instead of a screenshot.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onFile(f: File | null) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return setError("Please choose a PNG, JPEG, WebP or GIF screenshot.");
    setBusy("Reading screenshot…");
    setError(null);
    try {
      const t = await ocrImage(f, (p) => setBusy(`Reading screenshot… ${Math.round(p * 100)}%`));
      setText(t);
      await importText(t);
    } catch (e) {
      setError(`Could not read the screenshot: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const sorted = [...rows].sort((a, b) =>
    sort === "player" ? a.player.name.localeCompare(b.player.name) : (b.verdict?.p ?? 0) - (a.verdict?.p ?? 0),
  );

  return (
    <section className="card card-pad">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
            PrizePicks lines <Badge tone="ai">{rows.length} line{rows.length === 1 ? "" : "s"}</Badge>
          </h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Each line is the reference threshold: the model shows its probability of going <span className="text-pos">More</span> or{" "}
            <span className="text-neg">Less</span> automatically.{" "}
            {feedConfigured ? "Live lines load from your odds feed; imported lines take priority." : "Import your PrizePicks board below (screenshot or copy & paste)."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {signedIn ? (
            <>
              <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Import board"}</button>
              {rows.some((r) => r.origin === "imported") && (
                <button
                  className="btn btn-ghost text-ink-400"
                  onClick={async () => {
                    await apiFetch("/api/lines", { method: "DELETE" });
                    setSummary(null);
                    router.refresh();
                  }}
                >
                  Clear
                </button>
              )}
            </>
          ) : (
            <Link href="/login?next=/predictions" className="btn btn-primary">Sign in to import lines</Link>
          )}
        </div>
      </div>

      {open && signedIn && (
        <div className="mb-5 grid gap-4 rounded-lg border border-ink-700 bg-ink-850 p-4 md:grid-cols-2">
          <div>
            <div className="label mb-2">Screenshot of your PrizePicks board</div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className="flex h-36 w-full flex-col items-center justify-center rounded-lg border border-dashed border-ink-600 text-sm text-ink-300 hover:border-brand-bright/60"
              disabled={!!busy}
            >
              Tap to choose a screenshot
              <span className="mt-1 text-xs text-ink-500">Read on your device — nothing is sent to PrizePicks</span>
            </button>
            <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <div className="label mb-2">…or paste the board text</div>
            <textarea
              className="input h-36 font-mono text-xs"
              placeholder={"LeBron James\nPHI - F\n24.5\nPoints\n\nJalen Brunson\nNYK - G\n6.5\nAssists"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn mt-2 w-full" disabled={!text.trim() || !!busy} onClick={() => importText(text)}>
              Import lines
            </button>
          </div>
          {busy && <div className="text-sm text-brand-light md:col-span-2">{busy}</div>}
          {error && <div className="md:col-span-2"><ErrorNote>{error}</ErrorNote></div>}
        </div>
      )}
      {summary && (
        <div className="mb-4 text-xs text-ink-300">
          Imported {summary.saved} line{summary.saved === 1 ? "" : "s"}.
          {summary.skipped.length > 0 && <span className="text-ink-400"> Skipped {summary.skipped.length}: {summary.skipped.slice(0, 4).map((s) => s.reason).join("; ")}{summary.skipped.length > 4 ? "…" : ""}</span>}
        </div>
      )}

      {rows.length ? (
        <>
          <div className="mb-2 flex justify-end gap-1">
            <button className={cx("chip", sort === "strength" && "chip-active")} onClick={() => setSort("strength")}>Strongest first</button>
            <button className={cx("chip", sort === "player" && "chip-active")} onClick={() => setSort("player")}>By player</button>
          </div>
          <div className="scrollbar-thin overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Line</th>
                  <th className="text-right">Projection</th>
                  <th className="text-right">More</th>
                  <th className="text-right">Less</th>
                  <th>AI verdict</th>
                  <th>Confidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={`${r.player.id}-${r.statKey}-${r.gameId}`}>
                    <td>
                      <Link href={`/players/${r.player.id}`} className="flex items-center gap-2 hover:text-white">
                        <PlayerAvatar name={r.player.name} imageUrl={r.player.imageUrl} size="sm" ringColor={r.player.team?.colors.primary} />
                        <span>
                          <span className="block text-ink-100">{r.player.name}</span>
                          <span className="block text-[11px] text-ink-400">
                            {r.player.team?.abbreviation} vs {r.opponent}
                            {r.gameDate ? ` · ${fmtDate(r.gameDate)}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="num font-semibold text-white">{r.line}</span> <span className="text-ink-300">{r.statLabel}</span>
                      <div className="text-[10px] uppercase tracking-wider text-ink-500">{r.origin === "feed" ? "PrizePicks · live" : "PrizePicks · imported"}</div>
                    </td>
                    <td className="num text-right">{r.projection == null ? "—" : r.projection.toFixed(1)}</td>
                    <td className={cx("num text-right", r.pOver != null && r.pOver > (r.pUnder ?? 0) && "font-semibold text-pos")}>{pct(r.pOver, 1)}</td>
                    <td className={cx("num text-right", r.pUnder != null && r.pUnder > (r.pOver ?? 0) && "font-semibold text-neg")}>{pct(r.pUnder, 1)}</td>
                    <td>
                      {r.verdict ? (
                        <VerdictBadge side={r.verdict.side} sideWords={["More", "Less"]} label={r.verdict.label} pct={r.verdict.p} />
                      ) : (
                        <span className="text-xs text-ink-500" title={r.error ?? ""}>{r.error ? "Not enough data" : "—"}</span>
                      )}
                    </td>
                    <td>{r.confidence && <ConfidencePill level={r.confidence.level} score={r.confidence.score} />}</td>
                    <td>
                      {r.gameId && (
                        <Link className="text-xs text-brand-light hover:text-white" href={`/predictions?player=${r.player.id}&game=${r.gameId}&stat=${r.statKey}`}>
                          Full analysis →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            The verdict is for the side the model favours (More or Less). Probabilities are model estimates calibrated on past games, not guarantees.
          </p>
        </>
      ) : (
        !open && <div className="py-6 text-center text-sm text-ink-400">{signedIn ? "No PrizePicks lines yet — click “Import board” and drop in a screenshot of your board." : "Sign in to import your PrizePicks board and see the probability for every line."}</div>
      )}
    </section>
  );
}
