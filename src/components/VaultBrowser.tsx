"use client";

import { UploadImage } from "./UploadImage";
import { apiFetch } from "@/lib/api";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { VaultItem } from "@/lib/store/types";
import type { PlayerVM, TeamVM } from "@/lib/view";
import { PlayerAvatar, TeamLogo } from "./media";
import { Badge, EmptyState, ErrorNote, SportTag } from "./ui";
import { cx, fmtDate, pct } from "@/lib/format";

const TYPES = ["player", "team", "matchup", "forecast", "report", "screenshot", "note"] as const;
const SPORT_LABEL: Record<string, string> = { nba: "NBA", nfl: "NFL", mlb: "MLB", nhl: "NHL", soccer: "Soccer" };

export function VaultBrowser({ items: initial, players, teams, openId }: { items: VaultItem[]; players: Record<string, PlayerVM>; teams: Record<string, TeamVM>; openId?: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [q, setQ] = useState("");
  const [sport, setSport] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "sport">("date");
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setItems(initial), [initial]);

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (sport && i.sport !== sport) return false;
        if (type && i.type !== type) return false;
        if (from && i.createdAt.slice(0, 10) < from) return false;
        if (to && i.createdAt.slice(0, 10) > to) return false;
        if (q) {
          const names = [...(i.refs.playerIds ?? []).map((id) => players[id]?.name), ...(i.refs.teamIds ?? []).map((id) => teams[id]?.fullName)].join(" ");
          if (!`${i.title} ${i.notes} ${i.tags.join(" ")} ${names}`.toLowerCase().includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [items, sport, type, from, to, q, players, teams],
  );

  const groups = useMemo(() => {
    const m = new Map<string, VaultItem[]>();
    for (const i of filtered) {
      const k = groupBy === "date" ? i.createdAt.slice(0, 10) : i.sport ?? "general";
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [filtered, groupBy]);

  const current = items.find((i) => i.id === open) ?? null;

  async function create(body: Record<string, unknown>) {
    const r = await apiFetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Could not save");
    setItems((xs) => [d.item, ...xs]);
    setOpen(d.item.id);
    router.refresh();
  }

  async function uploadScreenshot(f: File | null) {
    if (!f) return;
    setBusy("Uploading…");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await apiFetch("/api/uploads", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Upload failed");
      await create({ type: "screenshot", title: f.name, sport: sport || null, refs: {}, uploadId: d.upload.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <div className="card card-pad space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input className="input lg:col-span-2" placeholder="Search titles, notes, tags, players, teams" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved research" />
            <select className="input" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
              <option value="">All sports</option>
              {Object.entries(SPORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-400">From <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex items-center gap-2 text-xs text-ink-400">To <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <div className="ml-auto flex gap-1">
              <button className={cx("chip", groupBy === "date" && "chip-active")} onClick={() => setGroupBy("date")}>By date</button>
              <button className={cx("chip", groupBy === "sport" && "chip-active")} onClick={() => setGroupBy("sport")}>By sport</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-ink-800 pt-3">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>Upload screenshot</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => uploadScreenshot(e.target.files?.[0] ?? null)} />
            <button
              className="btn"
              disabled={!!busy}
              onClick={async () => {
                setError(null);
                try {
                  await create({ type: "note", title: `Note · ${new Date().toLocaleDateString()}`, sport: sport || null, refs: {}, notes: "" });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              New note
            </button>
            {busy && <span className="self-center text-xs text-ai">{busy}</span>}
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>

        {!items.length ? (
          <EmptyState
            title="Your vault is empty"
            body="Save players, teams, matchups, forecasts and Pick Analyzer reports, upload screenshots, or start a note."
            action={<Link className="btn" href="/players">Browse players</Link>}
          />
        ) : !filtered.length ? (
          <EmptyState title="No saved research matches these filters" />
        ) : (
          groups.map(([k, list]) => (
            <div key={k}>
              <div className="label mb-2">{groupBy === "date" ? fmtDate(k + "T12:00:00Z", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : SPORT_LABEL[k] ?? "General"}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {list.map((i) => (
                  <button key={i.id} onClick={() => setOpen(i.id)} className={cx("card flex flex-col gap-3 p-4 text-left transition-colors hover:border-ink-500", open === i.id && "border-ai/50")}>
                    <div className="flex items-center gap-2">
                      <Badge tone={i.type === "report" || i.type === "forecast" ? "ai" : "neutral"}>{i.type}</Badge>
                      {i.sport && <SportTag sport={i.sport} />}
                      <span className="ml-auto text-[11px] text-ink-500">{fmtDate(i.createdAt)}</span>
                    </div>
                    <div className="line-clamp-2 text-sm font-medium text-ink-100">{i.title}</div>
                    <Thumbs item={i} players={players} teams={teams} />
                    {i.notes && <div className="line-clamp-2 text-xs text-ink-400">{i.notes}</div>}
                    {i.tags.length > 0 && <div className="flex flex-wrap gap-1">{i.tags.map((t) => <span key={t} className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">#{t}</span>)}</div>}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="xl:sticky xl:top-32 xl:self-start">
        {current ? (
          <Detail key={current.id} item={current} players={players} teams={teams} onChange={(it) => setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)))} onDelete={(id) => { setItems((xs) => xs.filter((x) => x.id !== id)); setOpen(null); router.refresh(); }} />
        ) : (
          <div className="card card-pad text-center text-sm text-ink-400">Select an item to view details and edit notes.</div>
        )}
      </div>
    </div>
  );
}

function Thumbs({ item, players, teams }: { item: VaultItem; players: Record<string, PlayerVM>; teams: Record<string, TeamVM> }) {
  const ps = (item.refs.playerIds ?? []).map((id) => players[id]).filter(Boolean);
  const ts = (item.refs.teamIds ?? []).map((id) => teams[id]).filter(Boolean);
  if (item.type === "screenshot" && item.uploadId)
    // eslint-disable-next-line @next/next/no-img-element
    return <UploadImage id={item.uploadId} alt={item.title} className="h-28 w-full rounded-md border border-ink-700 object-cover object-top" />;
  if (!ps.length && !ts.length) return null;
  return (
    <div className="flex items-center gap-2">
      {ps.slice(0, 3).map((p) => <PlayerAvatar key={p.id} name={p.name} imageUrl={p.imageUrl} size="sm" ringColor={p.team?.colors.primary} />)}
      {ts.slice(0, 3).map((t) => <TeamLogo key={t.id} abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="sm" />)}
      <span className="truncate text-xs text-ink-400">{[...ps.map((p) => p.name), ...ts.map((t) => t.abbreviation)].slice(0, 3).join(", ")}</span>
    </div>
  );
}

function Detail({ item, players, teams, onChange, onDelete }: { item: VaultItem; players: Record<string, PlayerVM>; teams: Record<string, TeamVM>; onChange: (i: VaultItem) => void; onDelete: (id: string) => void }) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirm, setConfirm] = useState(false);
  const dirty = title !== item.title || notes !== item.notes || tags !== item.tags.join(", ");
  const save = async () => {
    setState("saving");
    const r = await apiFetch(`/api/vault/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }) });
    if (!r.ok) return setState("error");
    onChange((await r.json()).item);
    setState("saved");
  };
  const del = async () => {
    const r = await apiFetch(`/api/vault/${item.id}`, { method: "DELETE" });
    if (r.ok) onDelete(item.id);
  };
  const payload = item.payload as Record<string, unknown> | null;
  const forecast = (payload?.forecast ?? null) as { projection?: number; threshold?: number; pOver?: number; pUnder?: number; statLabel?: string; confidence?: { level: string } } | null;
  return (
    <div className="card card-pad space-y-4">
      <input className="input text-base font-medium" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
        <Badge>{item.type}</Badge>
        {item.sport && <SportTag sport={item.sport} />}
        Saved {fmtDate(item.createdAt, { month: "short", day: "numeric", year: "numeric" })}
        {item.updatedAt !== item.createdAt && <> · edited {fmtDate(item.updatedAt)}</>}
      </div>
      <Thumbs item={item} players={players} teams={teams} />
      {forecast && forecast.projection != null && (
        <div className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm">
          <div className="label mb-1">Snapshot at save time</div>
          <div className="text-ink-200">
            {forecast.statLabel}: projection <span className="num text-white">{forecast.projection.toFixed(1)}</span>, threshold <span className="num text-white">{forecast.threshold}</span>
          </div>
          <div className="num text-xs text-ink-400">P(above) {pct(forecast.pOver ?? null, 1)} · P(below) {pct(forecast.pUnder ?? null, 1)} · {forecast.confidence?.level} confidence</div>
        </div>
      )}
      {Array.isArray(payload?.strengths) && (
        <div className="text-xs text-ink-300">
          {(payload!.strengths as string[]).slice(0, 3).map((s) => <div key={s}>▲ {s}</div>)}
          {((payload!.weaknesses as string[]) ?? []).slice(0, 3).map((s) => <div key={s}>▼ {s}</div>)}
        </div>
      )}
      {Array.isArray(payload?.edges) && <div className="space-y-1 text-xs text-ink-300">{(payload!.edges as string[]).slice(0, 4).map((s) => <div key={s}>• {s}</div>)}</div>}
      <div className="flex flex-wrap gap-2 text-xs">
        {(item.refs.playerIds ?? []).map((id) => players[id] && <Link key={id} href={`/players/${id}`} className="link">{players[id].name} →</Link>)}
        {(item.refs.teamIds ?? []).map((id) => teams[id] && <Link key={id} href={`/teams/${id}`} className="link">{teams[id].abbreviation} →</Link>)}
        {item.refs.gameId && <Link href={`/matchups/${item.refs.gameId}`} className="link">Matchup →</Link>}
      </div>
      <label className="block text-xs text-ink-400">
        Personal notes
        <textarea className="input mt-1 h-40" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Your observations, questions, follow-ups…" />
      </label>
      <label className="block text-xs text-ink-400">
        Tags (comma separated)
        <input className="input mt-1" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary" onClick={save} disabled={!dirty || state === "saving"}>{state === "saving" ? "Saving…" : "Save changes"}</button>
        {state === "saved" && !dirty && <span className="text-xs text-pos">Saved</span>}
        {state === "error" && <span className="text-xs text-neg">Could not save</span>}
        <div className="ml-auto">
          {confirm ? (
            <span className="flex gap-2">
              <button className="btn btn-danger" onClick={del}>Confirm delete</button>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn btn-ghost text-neg" onClick={() => setConfirm(true)}>Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}
