"use client";

import { apiFetch } from "@/lib/api";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ParsedLeg, ParsedSlip, Leg } from "@/lib/parse/parlay";
import type { ParlayResult, LegResult } from "@/lib/server/parlay";
import type { PlayerVM, TeamVM } from "@/lib/view";
import { PlayerAvatar, TeamLogo } from "./media";
import { Badge, ConfidencePill, ErrorNote, KPI, VerdictBadge, Warning } from "./ui";
import { cx, fmtDateTime, pct } from "@/lib/format";
import { ocrImage } from "@/lib/ocr-client";

interface Directory {
  players: PlayerVM[];
  teams: TeamVM[];
  stats: Record<string, { key: string; label: string; groups: string[] }[]>;
}

type Kind = Leg["kind"];
interface Row {
  uid: string;
  kind: Kind;
  playerId: string;
  teamId: string;
  opponentId: string; // game context read from the slip ("Knicks @ Pacers")
  statKey: string;
  line: string;
  side: "over" | "under";
  odds: string;
  raw?: string;
  issues: string[];
}

const KIND_LABEL: Record<Kind, string> = { player: "Player prop", moneyline: "Moneyline (to win)", spread: "Spread", total: "Game total", draw: "Draw" };
const uid = () => Math.random().toString(36).slice(2, 10);
const blank = (kind: Kind = "player"): Row => ({ uid: uid(), kind, playerId: "", teamId: "", opponentId: "", statKey: "", line: "", side: "over", odds: "", issues: [] });
const fmtOdds = (o: number | null | undefined) => (o == null ? "—" : o > 0 ? `+${o}` : String(o));

function toRow(p: ParsedLeg): Row {
  const l = p.leg as Partial<Record<string, unknown>> & { kind: Kind };
  return {
    uid: uid(),
    kind: l.kind,
    playerId: (l.playerId as string) ?? "",
    teamId: (l.teamId as string) ?? "",
    opponentId: (l.opponentId as string) ?? "",
    statKey: (l.statKey as string) ?? "",
    line: l.line == null ? "" : String(l.line),
    side: (l.side as "over" | "under") ?? "over",
    odds: p.odds == null ? "" : String(p.odds),
    raw: p.raw,
    issues: p.issues,
  };
}

function rowToLeg(r: Row): Leg | null {
  const line = Number(r.line);
  const opponentId = r.opponentId || undefined;
  const hasLine = r.line.trim() !== "" && Number.isFinite(line);
  switch (r.kind) {
    case "player":
      return r.playerId && r.statKey && hasLine ? { kind: "player", playerId: r.playerId, statKey: r.statKey, line, side: r.side, opponentId } : null;
    case "moneyline":
      return r.teamId ? { kind: "moneyline", teamId: r.teamId, opponentId } : null;
    case "draw":
      return r.teamId ? { kind: "draw", teamId: r.teamId, opponentId } : null;
    case "spread":
      return r.teamId && hasLine ? { kind: "spread", teamId: r.teamId, line, opponentId } : null;
    case "total":
      return r.teamId && hasLine ? { kind: "total", teamId: r.teamId, side: r.side, line, opponentId } : null;
  }
}

const parseOdds = (s: string) => {
  const n = Number(s.replace(/\s/g, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
};

export function ParlayAnalyzer({ dir, signedIn }: { dir: Directory; signedIn: boolean }) {
  const [tab, setTab] = useState<"screenshot" | "paste">("screenshot");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [parlayOdds, setParlayOdds] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParlayResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrText, setOcrText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const players = useMemo(() => new Map(dir.players.map((p) => [p.id, p])), [dir.players]);
  const teams = useMemo(() => new Map(dir.teams.map((t) => [t.id, t])), [dir.teams]);
  const teamsSorted = useMemo(() => [...dir.teams].sort((a, b) => a.sport.localeCompare(b.sport) || a.fullName.localeCompare(b.fullName)), [dir.teams]);

  async function parse(source: string) {
    setBusy("Reading the legs on your slip…");
    setError(null);
    setResult(null);
    try {
      const r = await apiFetch("/api/parlay/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: source }) });
      const d = (await r.json()) as ParsedSlip & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Extraction failed");
      if (!d.legs.length) setError("No legs were recognised. Check the text below (OCR can misread names) or add legs manually.");
      setRows(d.legs.map(toRow));
      setParlayOdds(d.parlayOdds == null ? "" : String(d.parlayOdds));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runOcr() {
    if (!file) return;
    setBusy("Reading screenshot (OCR)…");
    setError(null);
    setOcrProgress(0);
    try {
      const t = await ocrImage(file, (p) => setOcrProgress(p), { layout: "rows" });
      setOcrText(t);
      setOcrProgress(null);
      await parse(t);
    } catch (e) {
      setOcrProgress(null);
      setBusy(null);
      setError(`OCR failed: ${e instanceof Error ? e.message : String(e)}. You can paste the slip text instead.`);
    }
  }

  function onFile(f: File | null) {
    setError(null);
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) return setError("Please choose a PNG, JPEG, WebP or GIF image.");
    if (f.size > 8 * 1024 * 1024) return setError("Image must be 8 MB or smaller.");
    setFile(f);
    setOcrText("");
    setPreview(URL.createObjectURL(f));
  }

  const update = (u: string, patch: Partial<Row>) => {
    setResult(null);
    setRows((rs) => rs.map((r) => (r.uid === u ? { ...r, ...patch } : r)));
  };

  const ready = rows.map((r) => ({ r, leg: rowToLeg(r) }));
  const validCount = ready.filter((x) => x.leg).length;

  async function analyze() {
    setBusy("Calculating the chance of each leg…");
    setError(null);
    try {
      const legs = ready.filter((x) => x.leg).map((x) => ({ leg: x.leg, odds: parseOdds(x.r.odds) }));
      const r = await apiFetch("/api/parlay/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs, parlayOdds: parseOdds(parlayOdds) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Analysis failed");
      setResult(d);
      setTimeout(() => document.getElementById("parlay-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card card-pad">
        <div className="mb-4 flex flex-wrap items-center gap-1" role="tablist">
          {(["screenshot", "paste"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("chip", tab === t && "chip-active")}>
              {t === "screenshot" ? "Bet slip screenshot" : "Copy & paste"}
            </button>
          ))}
          <button className="btn btn-ghost ml-auto text-xs" onClick={() => setRows((rs) => [...rs, blank()])}>
            + Add a leg manually
          </button>
        </div>

        {tab === "screenshot" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => fileRef.current?.click()}
              className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-ink-600 bg-ink-850 p-4 text-center hover:border-ai/50"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Uploaded bet slip preview" className="max-h-72 rounded object-contain" />
              ) : (
                <>
                  <div className="text-sm text-ink-100">Tap to choose your bet slip screenshot</div>
                  <div className="mt-1 text-xs text-ink-400">Player props, moneylines, spreads and totals. PNG, JPEG, WebP or GIF up to 8 MB — read in your browser.</div>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex flex-col gap-3">
              <button className="btn btn-primary" disabled={!file || !!busy} onClick={runOcr}>
                {ocrProgress != null ? `Reading… ${Math.round(ocrProgress * 100)}%` : "Read my slip"}
              </button>
              {ocrProgress != null && (
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full bg-ai transition-all" style={{ width: `${ocrProgress * 100}%` }} />
                </div>
              )}
              {ocrText && (
                <div>
                  <div className="label mb-1">Recognised text (editable)</div>
                  <textarea className="input h-36 font-mono text-xs" value={ocrText} onChange={(e) => setOcrText(e.target.value)} />
                  <button className="btn mt-2" onClick={() => parse(ocrText)} disabled={!!busy}>
                    Re-read edited text
                  </button>
                </div>
              )}
              <p className="text-[11px] text-ink-400">OCR can misread names and numbers — every leg is shown below so you can fix it before the analysis.</p>
            </div>
          </div>
        )}

        {tab === "paste" && (
          <div>
            <textarea
              className="input h-44 font-mono text-xs"
              placeholder={"One leg per line, e.g.\nLeBron James Over 19.5 Points -115\nDenver Nuggets Moneyline -180\nDetroit Pistons -3.5 -110\nOilers @ Maple Leafs Over 6.5 Total Goals -105\n4 Leg Parlay +1250"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn btn-primary mt-3" disabled={!text.trim() || !!busy} onClick={() => parse(text)}>
              Read legs
            </button>
          </div>
        )}
        {busy && <div className="mt-4 text-sm text-ai">{busy}</div>}
        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card card-pad">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-100">Confirm your legs</h2>
              <p className="text-xs text-ink-400">Fix anything that was misread. Team legs use each team&apos;s next game.</p>
            </div>
            <label className="text-xs text-ink-400">
              Parlay odds (optional)
              <input className="input mt-1 w-32" placeholder="+1250" value={parlayOdds} onChange={(e) => setParlayOdds(e.target.value)} />
            </label>
          </div>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <LegEditor key={r.uid} n={i + 1} row={r} dir={dir} players={players} teams={teams} teamsSorted={teamsSorted} onChange={(p) => update(r.uid, p)} onRemove={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))} valid={!!ready[i].leg} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={!validCount || !!busy} onClick={analyze}>
              Analyze parlay ({validCount} leg{validCount === 1 ? "" : "s"})
            </button>
            <button className="btn btn-ghost text-xs" onClick={() => setRows((rs) => [...rs, blank()])}>
              + Add leg
            </button>
            {validCount < rows.length && <span className="text-xs text-warn">{rows.length - validCount} incomplete leg(s) will be skipped</span>}
          </div>
        </div>
      )}

      {result && <ParlayReport result={result} signedIn={signedIn} file={file} />}
    </div>
  );
}

function LegEditor({
  n,
  row: r,
  dir,
  players,
  teams,
  teamsSorted,
  onChange,
  onRemove,
  valid,
}: {
  n: number;
  row: Row;
  dir: Directory;
  players: Map<string, PlayerVM>;
  teams: Map<string, TeamVM>;
  teamsSorted: TeamVM[];
  onChange: (p: Partial<Row>) => void;
  onRemove: () => void;
  valid: boolean;
}) {
  const p = players.get(r.playerId);
  const t = teams.get(r.teamId);
  const statOpts = p ? dir.stats[p.sport].filter((s) => s.groups.includes(p.positionGroup)) : [];
  const [q, setQ] = useState("");
  const matches = q.trim().length >= 2 ? dir.players.filter((x) => x.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const needsLine = r.kind === "player" || r.kind === "spread" || r.kind === "total";
  const needsSide = r.kind === "player" || r.kind === "total";

  return (
    <div className={cx("rounded-lg border p-3", valid ? "border-ink-700" : "border-warn/40")}>
      <div className="grid items-end gap-3 md:grid-cols-[28px_150px_minmax(0,2fr)_minmax(0,1.3fr)_90px_110px_90px_auto]">
        <div className="pb-2 text-sm font-semibold text-ink-400">{n}</div>
        <label className="text-xs text-ink-400">
          Bet type
          <select className="input mt-1" value={r.kind} onChange={(e) => onChange({ kind: e.target.value as Kind })}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        {r.kind === "player" ? (
          <label className="relative text-xs text-ink-400">
            Player
            <div className="mt-1 flex items-center gap-2">
              {p && <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="sm" ringColor={p.team?.colors.primary} />}
              <input className="input" placeholder={p ? `${p.name} (${p.team?.abbreviation})` : "Search player…"} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {matches.length > 0 && (
              <div className="absolute left-0 right-0 top-14 z-10 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-xl">
                {matches.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-100 hover:bg-ink-800"
                    onClick={() => {
                      onChange({ playerId: x.id, statKey: "", opponentId: "" });
                      setQ("");
                    }}
                  >
                    <PlayerAvatar name={x.name} imageUrl={x.imageUrl} size="xs" />
                    {x.name}
                    <span className="ml-auto text-xs text-ink-400">{x.team?.abbreviation} · {x.sport.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            )}
          </label>
        ) : (
          <label className="text-xs text-ink-400">
            Team
            <div className="mt-1 flex items-center gap-2">
              {t && <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="xs" />}
              <select className="input" value={r.teamId} onChange={(e) => onChange({ teamId: e.target.value, opponentId: "" })}>
                <option value="">Select team…</option>
                {teamsSorted.map((x) => (
                  <option key={x.id} value={x.id}>{x.fullName} ({x.sport.toUpperCase()})</option>
                ))}
              </select>
            </div>
          </label>
        )}
        {r.kind === "player" ? (
          <label className="text-xs text-ink-400">
            Statistic
            <select className="input mt-1" value={r.statKey} onChange={(e) => onChange({ statKey: e.target.value })} disabled={!p}>
              <option value="">Select…</option>
              {statOpts.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="pb-2 text-xs text-ink-500">{r.kind === "total" ? "Combined score of both teams" : r.kind === "spread" ? "Negative = team gives points" : r.kind === "draw" ? "Game ends level" : "Team wins the game"}</div>
        )}
        <label className="text-xs text-ink-400">
          Line
          <input className="input mt-1" inputMode="decimal" value={r.line} disabled={!needsLine} placeholder={needsLine ? "" : "—"} onChange={(e) => onChange({ line: e.target.value })} />
        </label>
        <label className="text-xs text-ink-400">
          Side
          <select className="input mt-1" value={r.side} disabled={!needsSide} onChange={(e) => onChange({ side: e.target.value as Row["side"] })}>
            <option value="over">{r.kind === "player" ? "More / Over" : "Over"}</option>
            <option value="under">{r.kind === "player" ? "Less / Under" : "Under"}</option>
          </select>
        </label>
        <label className="text-xs text-ink-400">
          Odds
          <input className="input mt-1" placeholder="-110" value={r.odds} onChange={(e) => onChange({ odds: e.target.value })} />
        </label>
        <button className="btn btn-ghost mb-0.5 text-xs" onClick={onRemove} aria-label={`Remove leg ${n}`}>
          Remove
        </button>
      </div>
      {(r.raw || r.issues.length > 0 || r.opponentId) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-400">
          {r.raw && <span className="font-mono">“{r.raw}”</span>}
          {r.opponentId && teams.get(r.opponentId) && <span className="text-ink-300">Game: vs {teams.get(r.opponentId)!.fullName}</span>}
          {r.issues.map((x) => (
            <span key={x} className="text-warn">⚠ {x}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ParlayReport({ result: r, signedIn, file }: { result: ParlayResult; signedIn: boolean; file: File | null }) {
  const [save, setSave] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const valid = r.legs.filter((l) => l.ok);
  const edge = r.probability != null && r.impliedProbability != null && !r.settled.busted ? r.probability - r.impliedProbability : null;

  async function saveReport() {
    setSave("busy");
    try {
      let uploadId: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const u = await apiFetch("/api/uploads", { method: "POST", body: fd });
        if (u.ok) uploadId = (await u.json()).upload.id;
      }
      const res = await apiFetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "report",
          title: `Parlay · ${valid.length} legs · ${r.probability != null ? pct(r.probability) : "—"} to hit`,
          sport: valid[0]?.sport,
          refs: {
            playerIds: valid.flatMap((l) => (l.player ? [l.player.id] : [])),
            teamIds: [...new Set(valid.flatMap((l) => [l.team?.id, l.opponent?.id].filter(Boolean) as string[]))],
          },
          payload: { kind: "parlay", ...r },
          uploadId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSave("done");
    } catch (e) {
      setMsg((e as Error).message);
      setSave("error");
    }
  }

  return (
    <section id="parlay-result" className="card card-pad space-y-5 scroll-mt-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="ai">Parlay report</Badge>
            {r.label && !r.settled.busted && r.settled.pending > 0 && <VerdictBadge label={r.label} />}
          </div>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {r.settled.busted ? "This parlay has lost" : r.settled.pending === 0 ? "All legs settled" : `Chance all ${valid.length} legs hit`}
          </h2>
          <div className={cx("num text-5xl font-bold", r.settled.busted ? "text-neg" : r.settled.pending === 0 ? "text-pos" : "text-white")}>
            {r.settled.busted ? "LOST" : r.settled.pending === 0 ? "WON" : r.probability != null ? pct(r.probability) : "—"}
          </div>
          <p className="mt-1 text-xs text-ink-400">
            {r.settled.won + r.settled.lost + r.settled.push + r.settled.void > 0 &&
              `Settled: ${r.settled.won} won · ${r.settled.lost} lost${r.settled.push ? ` · ${r.settled.push} push` : ""}${r.settled.void ? ` · ${r.settled.void} void` : ""}${r.settled.pending ? ` · ${r.settled.pending} still to play` : ""}. `}
            {!r.settled.busted && r.settled.pending > 0 && <>Each remaining leg&apos;s probability multiplied together. On average about {r.expectedHits.toFixed(1)} of {valid.length} legs hit.</>}
          </p>
        </div>
        {signedIn ? (
          <button className="btn md:ml-auto" disabled={save === "busy" || save === "done"} onClick={saveReport}>
            {save === "done" ? "Saved to Vault ✓" : save === "busy" ? "Saving…" : "Save to Vault"}
          </button>
        ) : (
          <Link href="/login" className="btn md:ml-auto">Sign in to save</Link>
        )}
      </div>
      {save === "error" && <ErrorNote>{msg}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="Model fair odds" value={fmtOdds(r.fairOdds)} sub="What the model thinks it should pay" tone="ai" />
        <KPI label="Slip odds" value={fmtOdds(r.parlayOdds)} sub={r.impliedProbability != null ? `Implies ${pct(r.impliedProbability)} chance` : "Add odds to compare"} />
        <KPI
          label="Model vs payout"
          value={edge == null ? "—" : `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)} pts`}
          sub={edge == null ? (r.settled.busted ? "Parlay already lost" : "Needs slip odds") : edge >= 0 ? "Model chance above the payout's" : "Payout is lower than the model's chance"}
          tone={edge == null ? undefined : edge >= 0 ? "pos" : "neg"}
        />
        <KPI label="Weakest open leg" value={r.weakestLeg != null ? `#${r.weakestLeg + 1}` : "—"} sub={r.weakestLeg != null ? pct(r.legs[r.weakestLeg].probability) + " to hit" : undefined} tone="neg" />
      </div>

      {r.sameGameGroups.length > 0 && (
        <Warning>
          {r.sameGameGroups.length === 1 ? "Some legs come" : "Several legs come"} from the same game ({r.sameGameGroups.map((g) => g.join(" + ")).join("; ")}). Outcomes in one game move together, so the real combined chance can differ from the product shown.
        </Warning>
      )}

      <div className="space-y-2">
        {r.legs.map((l) => (
          <LegRow key={l.index} leg={l} weakest={l.index === r.weakestLeg && !r.settled.busted} />
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-500">
        No parlay is a guaranteed hit. Probabilities come from a statistical model of past games and every extra leg lowers the chance of the whole slip. For research and entertainment — if you choose to bet, only stake what you can afford to lose. 21+. Gambling problem? Call 1-800-GAMBLER.
      </p>
    </section>
  );
}

function LegRow({ leg: l, weakest }: { leg: LegResult; weakest: boolean }) {
  if (!l.ok)
    return (
      <div className="rounded-lg border border-neg/40 p-3 text-sm">
        <span className="font-semibold text-ink-300">Leg {l.index + 1}:</span> <span className="text-neg">{l.error}</span>
      </div>
    );
  const p = l.probability;
  return (
    <div className={cx("rounded-lg border p-3", l.outcome === "won" ? "border-pos/40" : l.outcome === "lost" ? "border-neg/50" : weakest ? "border-neg/50" : "border-ink-700")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="w-5 text-sm font-semibold text-ink-500">{l.index + 1}</span>
          {l.player ? (
            <PlayerAvatar name={l.player.name} imageUrl={l.player.imageUrl} size="md" ringColor={l.team?.colors.primary} />
          ) : l.team ? (
            <TeamLogo abbreviation={l.team.abbreviation} name={l.team.fullName} logoUrl={l.team.logoUrl} colors={l.team.colors} size="md" />
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{l.description}</div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
              <span>{KIND_LABEL[l.kind]}</span>
              {l.team && l.opponent && (
                <>
                  <span>·</span>
                  <Link href={`/matchups/${l.gameId}`} className="hover:text-white">
                    {l.team.abbreviation} vs {l.opponent.abbreviation}
                    {l.gameDate ? ` · ${fmtDateTime(l.gameDate)}` : ""}
                  </Link>
                </>
              )}
              {l.live && <Badge tone="warn">● Live — pre-game odds</Badge>}
            </div>
            <div className="text-xs text-ink-500">{l.detail}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 md:ml-auto">
          {l.outcome && (
            <div className="text-right">
              <Badge tone={l.outcome === "won" ? "pos" : l.outcome === "lost" ? "neg" : "neutral"}>{l.outcome === "won" ? "✓ Hit" : l.outcome === "lost" ? "✗ Missed" : l.outcome === "push" ? "Push" : "Void"}</Badge>
              {l.actual && <div className="mt-0.5 text-[11px] text-ink-400">{l.actual}</div>}
            </div>
          )}
          {!l.outcome && l.confidence && <ConfidencePill level={l.confidence} />}
          {!l.outcome && <VerdictBadge label={l.label} />}
          <div className="w-36">
            <div className="flex justify-between text-xs">
              <span className="num font-semibold text-white">{pct(p)}</span>
              <span className="num text-ink-400">{l.odds != null ? `${fmtOdds(l.odds)} → ${pct(l.impliedProbability!)}` : ""}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div className={cx("h-full", p >= 0.6 ? "bg-pos" : p >= 0.5 ? "bg-brand" : "bg-neg")} style={{ width: `${Math.round(p * 100)}%` }} />
            </div>
            {l.push > 0.005 && <div className="mt-0.5 text-[10px] text-ink-500">{pct(l.push)} chance of a push</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
