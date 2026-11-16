"use client";

import Link from "next/link";
import { useState } from "react";
import { PlayerAvatar, TeamLogo } from "./media";
import { AvailabilityBadge, EmptyState } from "./ui";
import type { RosterGroup } from "@/lib/server/roster-stats";
import type { TeamVM } from "@/lib/view";
import { cx } from "@/lib/format";

/** Tabbed player tables for the two teams in a matchup (season averages and, for finals, the box score). */
export function RosterTables({
  away,
  home,
  season,
  box,
  playingTimeShort,
  gameId,
  scheduled,
}: {
  away: TeamVM;
  home: TeamVM;
  season: { away: RosterGroup[]; home: RosterGroup[] };
  box: { away: RosterGroup[]; home: RosterGroup[] } | null;
  playingTimeShort: string;
  gameId: string;
  scheduled: boolean;
}) {
  const [team, setTeam] = useState<"away" | "home">("away");
  const [view, setView] = useState<"season" | "box">(box ? "box" : "season");
  const t = team === "away" ? away : home;
  const groups = (view === "box" && box ? box : season)[team];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["away", "home"] as const).map((k) => {
          const tv = k === "away" ? away : home;
          return (
            <button key={k} onClick={() => setTeam(k)} className={cx("chip gap-2 py-1.5", team === k && "chip-active")}>
              <TeamLogo abbreviation={tv.abbreviation} name={tv.fullName} logoUrl={tv.logoUrl} colors={tv.colors} size="xs" />
              {tv.fullName}
            </button>
          );
        })}
        {box && (
          <div className="ml-auto flex gap-1">
            <button className={cx("chip", view === "box" && "chip-active")} onClick={() => setView("box")}>This game</button>
            <button className={cx("chip", view === "season" && "chip-active")} onClick={() => setView("season")}>Season averages</button>
          </div>
        )}
      </div>
      {!groups.length ? (
        <EmptyState title={`No player stats for ${t.fullName} yet`} body="Stats appear once players have appeared in completed games (live data may still be syncing)." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="label mb-2">{g.label}s</div>
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-ink-800">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Player</th>
                      {view === "season" && <th className="text-right">GP</th>}
                      <th className="text-right">{playingTimeShort}</th>
                      {g.columns.map((c) => (
                        <th key={c.key} className="text-right" title={c.label}>
                          {c.short}
                        </th>
                      ))}
                      {view === "season" && g.columns[0] && <th className="text-right" title={`${g.columns[0].label}, last 5 games`}>L5 {g.columns[0].short}</th>}
                      {scheduled && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.player.id}>
                        <td>
                          <Link href={`/players/${r.player.id}`} className="flex items-center gap-2.5 hover:text-white">
                            <PlayerAvatar name={r.player.name} imageUrl={r.player.imageUrl} size="sm" ringColor={t.colors.primary} />
                            <span className="min-w-0">
                              <span className="block truncate text-ink-100">{r.player.name}</span>
                              <span className="flex items-center gap-1.5 text-[11px] text-ink-400">
                                {r.player.position} · #{r.player.jersey}
                                {r.player.injury && <AvailabilityBadge status={r.player.injury.status} description={r.player.injury.description} seasonEnding={r.player.injury.seasonEnding} returns={r.player.injury.expectedReturn} />}
                              </span>
                            </span>
                          </Link>
                        </td>
                        {view === "season" && <td className="num text-right">{r.games}</td>}
                        <td className="num text-right">{r.minutes}</td>
                        {r.values.map((v, i) => (
                          <td key={i} className={cx("num text-right", i === 0 && "font-semibold text-white")}>
                            {v}
                          </td>
                        ))}
                        {view === "season" && r.last5 != null && <td className="num text-right text-brand-light">{r.last5}</td>}
                        {scheduled && (
                          <td>
                            <Link href={`/predictions?player=${r.player.id}&game=${gameId}`} className="whitespace-nowrap text-xs text-brand-light hover:text-white">
                              Predict →
                            </Link>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
