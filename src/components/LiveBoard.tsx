"use client";

import { apiFetch } from "@/lib/api";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TeamLogo } from "./media";
import { EmptyState, SportTag } from "./ui";
import type { LiveGame } from "@/lib/types";
import type { TeamVM } from "@/lib/view";
import { cx, fmtTime } from "@/lib/format";

type Row = LiveGame & { home: TeamVM; away: TeamVM };

/** Live scoreboard: polls every 20s while games are in progress (60s otherwise). */
export function LiveBoard({ initial, sport }: { initial: Row[]; sport: string | null }) {
  const [games, setGames] = useState<Row[]>(initial);
  const [updated, setUpdated] = useState<Date>(new Date());
  const [error, setError] = useState(false);
  const anyLive = games.some((g) => g.state === "in");
  useEffect(() => {
    let stop = false;
    const t = setTimeout(
      async function tick() {
        try {
          const r = await apiFetch(`/api/live${sport ? `?sport=${sport}` : ""}`, { cache: "no-store" });
          const d = await r.json();
          if (!stop) {
            setGames(d.games);
            setUpdated(new Date());
            setError(false);
          }
        } catch {
          if (!stop) setError(true);
        }
      },
      anyLive ? 20_000 : 60_000,
    );
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [games, anyLive, sport]);

  const live = games.filter((g) => g.state === "in");
  const later = games.filter((g) => g.state === "pre");
  const finals = games.filter((g) => g.state === "post");

  const card = (g: Row) => {
    const isLive = g.state === "in";
    const final = g.state === "post";
    const side = (t: TeamVM, score: number | null, other: number | null) => (
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="sm" />
          <span className={cx("truncate text-sm", final && score != null && other != null && score < other ? "text-ink-400" : "text-ink-100")}>{t.fullName}</span>
        </div>
        {score != null && <span className={cx("num text-lg font-semibold", final && other != null && score < other ? "text-ink-400" : "text-white")}>{score}</span>}
      </div>
    );
    return (
      <Link key={g.id} href={`/matchups/${g.id}`} className={cx("card block p-4 transition-colors hover:border-ink-500", isLive && "border-neg/40")}>
        <div className="mb-3 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-2 text-ink-400">
            {!sport && <SportTag sport={g.sport} />}
            {isLive ? (
              <span className="flex items-center gap-1.5 font-bold text-neg">
                <span className="h-2 w-2 animate-pulse rounded-full bg-neg" aria-hidden />
                LIVE
              </span>
            ) : final ? (
              <span className="font-semibold text-ink-200">FINAL</span>
            ) : (
              <span>{fmtTime(g.date)}</span>
            )}
          </span>
          <span className={cx("num", isLive ? "text-ink-100" : "text-ink-500")}>{isLive ? g.detail : g.venue}</span>
        </div>
        <div className="space-y-2.5">
          {side(g.away, g.awayScore, g.homeScore)}
          {side(g.home, g.homeScore, g.awayScore)}
        </div>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>
          {live.length} live · {later.length} later today · {finals.length} final
        </span>
        <span className={error ? "text-warn" : ""}>
          {error ? "Couldn't refresh — retrying" : `Updated ${updated.toLocaleTimeString()}`} · auto-refresh {anyLive ? "20s" : "60s"}
        </span>
      </div>
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <span className="h-2 w-2 rounded-full bg-neg" aria-hidden /> Live now
        </h2>
        {live.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{live.map(card)}</div> : <EmptyState title="No games in progress right now" body="Live scores appear here automatically when games start." />}
      </section>
      {later.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">Later today</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{later.map(card)}</div>
        </section>
      )}
      {finals.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">Final</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{finals.map(card)}</div>
        </section>
      )}
    </div>
  );
}
