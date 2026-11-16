"use client";

import { apiFetch } from "@/lib/api";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ResearchReport } from "@/lib/engine/report";
import type { ParsedScenario } from "@/lib/parse/pick";
import type { PlayerVM, TeamVM } from "@/lib/view";
import { PlayerAvatar, TeamLogo } from "./media";
import { VerdictCard } from "./VerdictCard";
import { AiCallout, AvailabilityBadge, Badge, ConfidencePill, ErrorNote, ProbabilityBar, Warning } from "./ui";
import { cx, fmtDate, fmtDateTime, pct } from "@/lib/format";
import { ocrImage } from "@/lib/ocr-client";

interface Directory {
  players: PlayerVM[];
  teams: TeamVM[];
  stats: Record<string, { key: string; label: string; groups: string[] }[]>;
}

interface Row {
  uid: string;
  playerId: string;
  statKey: string;
  threshold: string;
  side: "" | "over" | "under";
  gameDate: string;
  issues: string[];
  raw?: string;
}

type Result = { ok: true; report: ResearchReport } | { ok: false; error: string; input: { playerId?: string } };

const uid = () => Math.random().toString(36).slice(2, 10);

export function Analyzer({ dir, signedIn }: { dir: Directory; signedIn: boolean }) {
  const [tab, setTab] = useState<"screenshot" | "paste" | "manual">("screenshot");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const players = useMemo(() => new Map(dir.players.map((p) => [p.id, p])), [dir.players]);
  const teams = useMemo(() => new Map(dir.teams.map((t) => [t.id, t])), [dir.teams]);

  const toRows = (scenarios: ParsedScenario[]): Row[] =>
    scenarios.map((s) => ({
      uid: uid(),
      playerId: s.playerId ?? "",
      statKey: s.statKey ?? "",
      threshold: s.threshold == null ? "" : String(s.threshold),
      side: s.side ?? "",
      gameDate: s.gameDate ?? "",
      issues: s.issues,
      raw: s.raw,
    }));

  async function parse(source: string) {
    setBusy("Extracting scenarios…");
    setError(null);
    setResults(null);
    try {
      const r = await apiFetch("/api/analyzer/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: source }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Extraction failed");
      if (!d.scenarios.length) setError("No known players were found in the text. Check spelling or add scenarios manually below.");
      setRows(toRows(d.scenarios));
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
      const text = await ocrImage(file, (p) => setOcrProgress(p));
      setOcrText(text);
      setOcrProgress(null);
      await parse(text);
    } catch (e) {
      setOcrProgress(null);
      setBusy(null);
      setError(`OCR failed: ${e instanceof Error ? e.message : String(e)}. You can paste the text instead.`);
    }
  }

  const [linesMsg, setLinesMsg] = useState<string | null>(null);
  async function saveAsLines() {
    const source = ocrText || text;
    if (!source.trim()) return;
    const r = await apiFetch("/api/lines/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: source }) });
    const d = await r.json().catch(() => ({}));
    setLinesMsg(r.status === 401 ? "Sign in to save lines." : r.ok ? `Saved ${d.saved.length} PrizePicks line${d.saved.length === 1 ? "" : "s"} — AI Predictions now uses them automatically.` : d.error ?? "Could not save lines");
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

  function update(u: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.uid === u ? { ...r, ...patch } : r)));
  }

  const validRows = rows.filter((r) => r.playerId && r.statKey && r.threshold.trim() !== "" && Number.isFinite(Number(r.threshold)));

  async function analyze() {
    setBusy("Running independent statistical breakdown…");
    setError(null);
    try {
      const r = await apiFetch("/api/analyzer/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarios: validRows.map((x) => ({ playerId: x.playerId, statKey: x.statKey, threshold: Number(x.threshold), side: x.side || null, gameDate: x.gameDate || null })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Analysis failed");
      setResults(d.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const filteredPlayers = playerQuery.trim().length >= 2 ? dir.players.filter((p) => p.name.toLowerCase().includes(playerQuery.toLowerCase())).slice(0, 8) : [];

  return (
    <div className="space-y-6">
      <div className="card card-pad">
        <div className="mb-4 flex gap-1" role="tablist">
          {(["screenshot", "paste", "manual"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("chip", tab === t && "chip-active")}>
              {t === "screenshot" ? "Screenshot upload" : t === "paste" ? "Copy & paste" : "Manual entry"}
            </button>
          ))}
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
                <img src={preview} alt="Uploaded screenshot preview" className="max-h-64 rounded object-contain" />
              ) : (
                <>
                  <div className="text-sm text-ink-100">Tap to choose a screenshot</div>
                  <div className="mt-1 text-xs text-ink-400">PNG, JPEG, WebP or GIF up to 8 MB. Text is read in your browser.</div>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex flex-col gap-3">
              <button className="btn btn-primary" disabled={!file || !!busy} onClick={runOcr}>
                {ocrProgress != null ? `Reading… ${Math.round(ocrProgress * 100)}%` : "Extract with OCR"}
              </button>
              {ocrProgress != null && (
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full bg-ai transition-all" style={{ width: `${ocrProgress * 100}%` }} />
                </div>
              )}
              {ocrText && (
                <div>
                  <div className="label mb-1">Recognised text (editable)</div>
                  <textarea className="input h-32 font-mono text-xs" value={ocrText} onChange={(e) => setOcrText(e.target.value)} />
                  <button className="btn mt-2" onClick={() => parse(ocrText)} disabled={!!busy}>
                    Re-extract from edited text
                  </button>
                </div>
              )}
              <p className="text-[11px] text-ink-400">OCR can misread names and numbers. Every extracted field is shown for confirmation before analysis.</p>
            </div>
          </div>
        )}

        {tab === "paste" && (
          <div>
            <textarea
              className="input h-40 font-mono text-xs"
              placeholder={"One scenario per line, e.g.\nTobias Delacroix over 16.5 points vs SLC 11/15\nWes Mercer passing yards 250.5 under"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn btn-primary mt-3" disabled={!text.trim() || !!busy} onClick={() => parse(text)}>
              Extract scenarios
            </button>
          </div>
        )}

        {tab === "manual" && (
          <div className="relative max-w-md">
            <input className="input" placeholder="Search a player to add a scenario" value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} />
            {filteredPlayers.length > 0 && (
              <div className="absolute left-0 right-0 top-11 z-10 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-xl">
                {filteredPlayers.map((p) => (
                  <button
                    key={p.id}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ink-800"
                    onClick={() => {
                      const st = dir.stats[p.sport].find((s) => s.groups.includes(p.positionGroup));
                      setRows((rs) => [...rs, { uid: uid(), playerId: p.id, statKey: st?.key ?? "", threshold: "", side: "", gameDate: "", issues: [] }]);
                      setPlayerQuery("");
                      setResults(null);
                    }}
                  >
                    <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="xs" />
                    {p.name}
                    <span className="ml-auto text-xs text-ink-400">
                      {p.team?.abbreviation} · {p.sport.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {busy && <div className="mt-4 text-sm text-ai">{busy}</div>}
        {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
      </div>

      {rows.length > 0 && (
        <div className="card card-pad">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink-100">Confirm extracted information</h2>
              <p className="text-xs text-ink-400">Edit anything that was misread. The game defaults to the player&apos;s next game when no date is given.</p>
            </div>
            <button className="btn btn-ghost text-xs" onClick={() => setRows((rs) => [...rs, { uid: uid(), playerId: "", statKey: "", threshold: "", side: "", gameDate: "", issues: [] }])}>
              + Add row
            </button>
          </div>
          <div className="space-y-3">
            {rows.map((r) => {
              const p = players.get(r.playerId);
              const team = p ? teams.get(p.teamId) : undefined;
              const statOpts = p ? dir.stats[p.sport].filter((s) => s.groups.includes(p.positionGroup)) : [];
              return (
                <div key={r.uid} className="rounded-lg border border-ink-700 p-3">
                  <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_110px_120px_150px_auto]">
                    <label className="text-xs text-ink-400">
                      Player
                      <div className="mt-1 flex items-center gap-2">
                        {p && <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="sm" ringColor={team?.colors.primary} />}
                        <select className="input" value={r.playerId} onChange={(e) => update(r.uid, { playerId: e.target.value, statKey: "" })}>
                          <option value="">Select player…</option>
                          {dir.players.map((x) => (
                            <option key={x.id} value={x.id}>{x.name} ({x.team?.abbreviation} · {x.sport.toUpperCase()})</option>
                          ))}
                        </select>
                      </div>
                    </label>
                    <label className="text-xs text-ink-400">
                      Statistic
                      <select className="input mt-1" value={r.statKey} onChange={(e) => update(r.uid, { statKey: e.target.value })} disabled={!p}>
                        <option value="">Select…</option>
                        {statOpts.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-400">
                      Threshold
                      <input className="input mt-1" inputMode="decimal" value={r.threshold} onChange={(e) => update(r.uid, { threshold: e.target.value })} />
                    </label>
                    <label className="text-xs text-ink-400">
                      Side
                      <select className="input mt-1" value={r.side} onChange={(e) => update(r.uid, { side: e.target.value as Row["side"] })}>
                        <option value="">Not specified</option>
                        <option value="over">Above</option>
                        <option value="under">Below</option>
                      </select>
                    </label>
                    <label className="text-xs text-ink-400">
                      Game date
                      <input type="date" className="input mt-1" value={r.gameDate} onChange={(e) => update(r.uid, { gameDate: e.target.value })} />
                    </label>
                    <button className="btn btn-ghost text-xs text-ink-400" onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))} aria-label="Remove scenario">
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {p && team && (
                      <span className="flex items-center gap-1.5 text-ink-400">
                        <TeamLogo abbreviation={team.abbreviation} name={team.fullName} logoUrl={team.logoUrl} colors={team.colors} size="xs" /> {team.fullName} · {p.sport.toUpperCase()}
                      </span>
                    )}
                    {r.raw && <span className="truncate font-mono text-ink-500">“{r.raw}”</span>}
                    {r.issues.map((i) => (
                      <Badge key={i} tone="warn">{i}</Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn btn-primary" onClick={analyze} disabled={!validRows.length || !!busy}>
              Analyze {validRows.length} confirmed scenario{validRows.length === 1 ? "" : "s"}
            </button>
            {validRows.length < rows.length && <span className="text-xs text-warn">{rows.length - validRows.length} row(s) need a player, statistic and numeric threshold.</span>}
            {(ocrText || text).trim() && signedIn && (
              <button className="btn btn-ghost ml-auto" onClick={saveAsLines} title="Use these thresholds as PrizePicks lines in AI Predictions">
                Save as my PrizePicks lines
              </button>
            )}
            {linesMsg && <span className="text-xs text-brand-light">{linesMsg}</span>}
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-6">
          {results.map((res, i) =>
            res.ok ? (
              <ReportCard key={i} report={res.report} players={players} teams={teams} signedIn={signedIn} file={file} />
            ) : (
              <ErrorNote key={i}>
                {players.get(res.input.playerId ?? "")?.name ?? "Scenario"}: {res.error}
              </ErrorNote>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report: r, players, teams, signedIn, file }: { report: ResearchReport; players: Map<string, PlayerVM>; teams: Map<string, TeamVM>; signedIn: boolean; file: File | null }) {
  const p = players.get(r.playerId)!;
  const team = teams.get(r.teamId)!;
  const opp = teams.get(r.opponentId)!;
  const f = r.forecast;
  const [save, setSave] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
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
          title: `Pick Analyzer · ${p.name} ${r.statLabel} ${r.input.threshold} · ${fmtDate(r.gameDate)}`,
          sport: p.sport,
          refs: { playerIds: [p.id], teamIds: [team.id, opp.id], gameId: r.gameId },
          payload: { ...r, forecast: { ...r.forecast, distribution: { ...r.forecast.distribution, pmf: undefined } } },
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
    <section className="card card-pad space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="xl" ringColor={team.colors.primary} />
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="ai">Research report</Badge>
              {f.sample.dataSource === "demo" && <Badge tone="warn">DEMO DATA</Badge>}
              <ConfidencePill level={f.confidence.level} score={f.confidence.score} />
              {r.injury && <AvailabilityBadge status={r.injury.status as never} description={r.injury.description} />}
            </div>
            <Link href={`/players/${p.id}`} className="mt-1 block text-lg font-semibold text-white hover:underline">{p.name}</Link>
            <div className="flex items-center gap-2 text-sm text-ink-300">
              <TeamLogo abbreviation={team.abbreviation} name={team.fullName} logoUrl={team.logoUrl} colors={team.colors} size="xs" /> {team.abbreviation}
              <span>{f.home ? "vs" : "@"}</span>
              <TeamLogo abbreviation={opp.abbreviation} name={opp.fullName} logoUrl={opp.logoUrl} colors={opp.colors} size="xs" /> {opp.abbreviation}
              <span className="text-ink-500">·</span>
              <Link href={`/matchups/${r.gameId}`} className="hover:text-white">{fmtDateTime(r.gameDate)}</Link>
            </div>
          </div>
        </div>
        <div className="md:ml-auto md:text-right">
          <div className="label">Scenario</div>
          <div className="text-base text-white">
            {r.statLabel} {r.input.side ? (r.input.side === "over" ? "above" : "below") : "vs"} <span className="num">{r.input.threshold}</span>
          </div>
          <div className="num text-sm text-ink-300">Projection {f.projection.toFixed(1)} · 80% range {f.interval80[0].toFixed(1)}–{f.interval80[1].toFixed(1)}</div>
          <div className={`mt-1 text-sm font-semibold ${r.verdict.tone === "pos" ? "text-pos" : r.verdict.tone === "neg" ? "text-neg" : "text-ink-200"}`}>
            AI verdict: {r.verdict.label} ({(r.verdict.pHit * 100).toFixed(0)}%)
          </div>
        </div>
      </div>
      <VerdictCard
        forecast={f}
        playerName={p.name}
        opponentName={opp.fullName}
        initial={r.verdict}
        narrative={r.verdictNarrative}
        trackRecord={r.trackRecord}
        demo={f.sample.dataSource === "demo"}
      />
      <ProbabilityBar pOver={f.pOver} pUnder={f.pUnder} pPush={f.pPush} threshold={f.threshold} />
      <AiCallout title="Research summary" source={r.narrative.source}>{r.narrative.text}</AiCallout>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="label mb-2">Statistical breakdown</div>
          <table className="table-base">
            <thead>
              <tr><th>Window</th><th className="text-right">G</th><th className="text-right">Avg</th><th className="text-right">Above {r.input.threshold}</th><th className="text-right">Time</th></tr>
            </thead>
            <tbody>
              {r.windows.map((w) => (
                <tr key={w.label}>
                  <td>{w.label}</td>
                  <td className="num text-right">{w.games}</td>
                  <td className="num text-right text-white">{w.avg == null ? "—" : w.avg.toFixed(2)}</td>
                  <td className="num text-right">{w.overRate == null ? "—" : pct(w.overRate, 0)}</td>
                  <td className="num text-right">{w.minutes == null ? "—" : w.minutes.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <div className="label mb-1">Defensive matchup</div>
            <p className="text-ink-300">{r.defensiveMatchup?.text ?? "No opponent profile available for this statistic."}</p>
          </div>
          <div>
            <div className="label mb-1">Offensive matchup</div>
            <p className="text-ink-300">{r.offensiveMatchup?.text ?? "—"}</p>
          </div>
          <div>
            <div className="label mb-1">Playing time</div>
            <p className="text-ink-300">{r.playingTime.text}</p>
          </div>
          <div>
            <div className="label mb-1">Injury information</div>
            <p className="text-ink-300">{r.injury ? `${r.injury.status}: ${r.injury.description}` : "No listed injury for this player."}</p>
          </div>
          <div>
            <div className="label mb-1">Correlated game conditions</div>
            <ul className="space-y-0.5 text-ink-300">{r.correlated.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div>
          <div className="label mb-2 text-pos">Supporting evidence</div>
          <ul className="space-y-1 text-sm text-ink-300">{f.supporting.length ? f.supporting.map((e, i) => <li key={i}>+ {e.text}</li>) : <li className="text-ink-500">None</li>}</ul>
        </div>
        <div>
          <div className="label mb-2 text-neg">Conflicting evidence</div>
          <ul className="space-y-1 text-sm text-ink-300">{f.conflicting.length ? f.conflicting.map((e, i) => <li key={i}>− {e.text}</li>) : <li className="text-ink-500">None</li>}</ul>
        </div>
        <div>
          <div className="label mb-2">Statistical trends</div>
          <ul className="space-y-1 text-sm text-ink-300">
            {r.patterns.length ? r.patterns.slice(0, 4).map((pt, i) => <li key={i}>• {pt.title}: {pt.detail}</li>) : <li className="text-ink-500">No statistically notable trends.</li>}
          </ul>
        </div>
      </div>

      <div className="space-y-2">
        <div className="label">Statistical concerns & uncertainty</div>
        {r.concerns.map((c) => <Warning key={c}>{c}</Warning>)}
        <p className="text-sm text-ink-300">{r.uncertainty}</p>
        <p className="text-[11px] text-ink-500">
          Sample: {f.sample.games} games ({f.sample.seasonGames} this season, {f.sample.h2hGames} vs opponent) · last game {f.sample.lastGameDate ? fmtDate(f.sample.lastGameDate) : "—"} · model {f.modelVersion}. For statistical education and research only — not a wagering recommendation.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-800 pt-4">
        {!signedIn ? (
          <Link href="/login" className="btn">Sign in to save this report</Link>
        ) : save === "done" ? (
          <Link href="/vault" className="btn border-pos/40 text-pos">✓ Saved — open vault</Link>
        ) : (
          <button className="btn" onClick={saveReport} disabled={save === "busy"}>{save === "busy" ? "Saving…" : file ? "Save report + screenshot to vault" : "Save report to vault"}</button>
        )}
        {save === "error" && <span className="text-xs text-neg">{msg}</span>}
        <Link href={`/predictions?player=${p.id}&game=${r.gameId}&stat=${r.input.statKey}&threshold=${r.input.threshold}`} className="btn btn-ghost">Open in AI Predictions →</Link>
      </div>
    </section>
  );
}
