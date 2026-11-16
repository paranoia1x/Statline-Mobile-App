"use client";

import { apiFetch } from "@/lib/api";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlayerAvatar } from "./media";
import type { PlayerVM } from "@/lib/view";

/** Saves a research snapshot to the user's vault. */
export function SaveToVault({
  type,
  title,
  sport,
  refs,
  payload,
  label = "Save to vault",
  className,
}: {
  type: "player" | "team" | "matchup" | "forecast" | "report";
  title: string;
  sport: string | null;
  refs: { playerIds?: string[]; teamIds?: string[]; gameId?: string };
  payload?: unknown;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "auth" | "error">("idle");
  const [msg, setMsg] = useState("");
  const save = async () => {
    setState("saving");
    const r = await apiFetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, title, sport, refs, payload }) });
    if (r.status === 401) return setState("auth");
    if (!r.ok) {
      setMsg((await r.json().catch(() => ({}))).error ?? "Could not save");
      return setState("error");
    }
    setState("saved");
  };
  if (state === "auth")
    return (
      <Link href="/login" className={`btn ${className ?? ""}`}>
        Sign in to save
      </Link>
    );
  if (state === "saved")
    return (
      <Link href="/vault" className={`btn border-pos/40 text-pos ${className ?? ""}`}>
        ✓ Saved — open vault
      </Link>
    );
  return (
    <span className="inline-flex items-center gap-2">
      <button className={`btn ${className ?? ""}`} onClick={save} disabled={state === "saving"}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path d="M6 3h12v18l-6-4-6 4z" />
        </svg>
        {state === "saving" ? "Saving…" : label}
      </button>
      {state === "error" && <span className="text-xs text-neg">{msg}</span>}
    </span>
  );
}

/** Adds a forecast to the Performance Tracker (server recomputes probabilities). */
export function TrackPrediction({
  body,
  label,
  disabledReason,
}: {
  body: Record<string, unknown>;
  label: string;
  disabledReason?: string | null;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "auth" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (disabledReason) return <span className="text-xs text-ink-400">{disabledReason}</span>;
  if (state === "auth")
    return (
      <Link href="/login" className="btn">
        Couldn't track
      </Link>
    );
  if (state === "done")
    return (
      <Link href="/tracker" className="btn border-pos/40 text-pos">
        ✓ Tracking — view tracker
      </Link>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="btn"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await apiFetch("/api/predictions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (r.status === 401) return setState("auth");
          if (!r.ok) {
            setMsg((await r.json().catch(() => ({}))).error ?? "Could not track");
            return setState("error");
          }
          setState("done");
        }}
      >
        {state === "busy" ? "Adding…" : label}
      </button>
      {state === "error" && <span className="text-xs text-neg">{msg}</span>}
    </span>
  );
}

const RECENT_KEY = "si_recent_players";

/** Records a player profile view in local storage (per-browser "recently researched"). */
export function RecordRecentPlayer({ id }: { id: string }) {
  useEffect(() => {
    try {
      const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 12)));
    } catch {
      /* storage unavailable */
    }
  }, [id]);
  return null;
}

export function RecentPlayers({ sport }: { sport: string | null }) {
  const [players, setPlayers] = useState<PlayerVM[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    } catch {
      ids = [];
    }
    if (!ids.length) return setPlayers([]);
    apiFetch(`/api/players?ids=${ids.join(",")}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPlayers(d.players))
      .catch(() => setError(true));
  }, []);
  if (error) return <div className="text-sm text-neg">Could not load recently researched players.</div>;
  if (!players) return <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>;
  const list = players.filter((p) => !sport || p.sport === sport);
  if (!list.length) return <div className="py-6 text-center text-sm text-ink-400">Players you open will appear here.</div>;
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {list.slice(0, 8).map((p) => (
        <Link key={p.id} href={`/players/${p.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-850">
          <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="sm" ringColor={p.team?.colors.primary} />
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink-100">{p.name}</span>
            <span className="block text-xs text-ink-400">
              {p.position} · {p.team?.abbreviation}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
