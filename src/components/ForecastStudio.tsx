"use client";

import { apiFetch } from "@/lib/api";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ForecastView, type ForecastPayload } from "./ForecastView";
import { PlayerAvatar, TeamLogo } from "./media";
import { ErrorNote } from "./ui";
import type { GameVM, PlayerVM } from "@/lib/view";
import { cx, fmtDate, fmtTime } from "@/lib/format";

export type StudioGame = GameVM;
export interface StudioStat {
  key: string;
  label: string;
  groups: string[];
}

export function ForecastStudio({
  games,
  rosters,
  lines,
  statsBySport,
  initial,
}: {
  games: StudioGame[];
  rosters: Record<string, PlayerVM[]>;
  lines: { playerId: string; statKey: string; line: number; gameId: string | null }[];
  statsBySport: Record<string, StudioStat[]>;
  initial: { gameId?: string; playerId?: string; statKey?: string; threshold?: string };
}) {
  const [gameId, setGameId] = useState(initial.gameId && games.some((g) => g.id === initial.gameId) ? initial.gameId : games[0]?.id ?? "");
  const selected = games.find((g) => g.id === gameId);
  const game = useMemo(
    () => (selected ? { ...selected, players: [...(rosters[selected.away.id] ?? []), ...(rosters[selected.home.id] ?? [])] } : undefined),
    [selected, rosters],
  );
  const [playerId, setPlayerId] = useState(initial.playerId ?? "");
  const player = game?.players.find((p) => p.id === playerId) ?? null;
  const stats = useMemo(() => (game && player ? statsBySport[game.sport].filter((s) => s.groups.includes(player.positionGroup)) : []), [game, player, statsBySport]);
  const [statKey, setStatKey] = useState(initial.statKey ?? "");
  const [threshold, setThreshold] = useState(initial.threshold ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForecastPayload | null>(null);

  useEffect(() => {
    if (game && !game.players.some((p) => p.id === playerId)) setPlayerId(game.players[0]?.id ?? "");
  }, [game, playerId]);
  const playerLines = useMemo(
    () => lines.filter((l) => l.playerId === playerId && (!l.gameId || l.gameId === game?.id) && stats.some((s) => s.key === l.statKey)),
    [lines, playerId, game, stats],
  );
  const linesByPlayer = useMemo(() => new Set(lines.map((l) => l.playerId)), [lines]);
  const currentLine = playerLines.find((l) => l.statKey === statKey) ?? null;
  // when the player changes, default to a statistic that has a PrizePicks line
  const lastPlayer = useRef<string | null>(null);
  useEffect(() => {
    if (!stats.length) return;
    const changedPlayer = lastPlayer.current !== null && lastPlayer.current !== playerId;
    const firstLoad = lastPlayer.current === null;
    lastPlayer.current = playerId;
    const valid = stats.some((s) => s.key === statKey);
    const preferred = playerLines[0]?.statKey ?? stats[0].key;
    if (!valid || changedPlayer || (firstLoad && !initial.statKey && playerLines.length && !playerLines.some((l) => l.statKey === statKey))) {
      setStatKey(preferred);
      setThreshold("");
    }
  }, [stats, statKey, playerId, playerLines, initial.statKey]);

  const reqId = useRef(0);
  const run = useCallback(async () => {
    if (!game || !playerId || !statKey) return;
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, statKey, gameId: game.id, threshold: threshold.trim() === "" ? null : threshold }),
      });
      const d = await r.json();
      if (my !== reqId.current) return; // a newer selection superseded this request
      if (!r.ok) throw new Error(d.error ?? "Forecast failed");
      setResult(d);
      // remember the selection in the URL (shareable) without reloading the page or changing the sport filter
      const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
      q.set("game", game.id);
      q.set("player", playerId);
      q.set("stat", statKey);
      if (threshold.trim()) q.set("threshold", threshold.trim());
      else q.delete("threshold");
      window.history.replaceState(window.history.state, "", `#/predictions?${q.toString()}`);
    } catch (e) {
      if (my !== reqId.current) return;
      setError((e as Error).message);
      setResult(null);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [game, playerId, statKey, threshold]);

  // Generate automatically whenever the game, player or statistic changes, so a prediction is
  // always on screen. Editing the threshold re-runs via the button (or Enter).
  const lastAuto = useRef("");
  useEffect(() => {
    if (!game || !player || !statKey || !stats.some((s) => s.key === statKey)) return;
    const key = `${game.id}|${player.id}|${statKey}`;
    if (lastAuto.current === key) return;
    lastAuto.current = key;
    run();
  }, [game, player, statKey, stats, run]);

  if (!games.length) return <div className="py-10 text-center text-sm text-ink-400">No upcoming games in the next 7 days for this sport filter.</div>;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div>
          <div className="label mb-2">1 · Game</div>
          <div className="scrollbar-thin max-h-72 space-y-1 overflow-y-auto pr-1">
            {games.map((g) => (
              <button
                key={g.id}
                onClick={() => setGameId(g.id)}
                className={cx("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition", g.id === gameId ? "border-ai/50 bg-ai/10" : "border-ink-700 hover:border-ink-500")}
              >
                <TeamLogo abbreviation={g.away.abbreviation} name={g.away.fullName} logoUrl={g.away.logoUrl} colors={g.away.colors} size="xs" />
                <span className="text-ink-100">{g.away.abbreviation}</span>
                <span className="text-ink-500">@</span>
                <TeamLogo abbreviation={g.home.abbreviation} name={g.home.fullName} logoUrl={g.home.logoUrl} colors={g.home.colors} size="xs" />
                <span className="text-ink-100">{g.home.abbreviation}</span>
                <span className="ml-auto text-[11px] text-ink-400">
                  {fmtDate(g.date)} {fmtTime(g.date)}
                </span>
              </button>
            ))}
          </div>
        </div>
        {game && (
          <div>
            <div className="label mb-2">2 · Player</div>
            <div className="scrollbar-thin grid max-h-80 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-ink-800 p-1 pr-1.5">
              {game.players.map((p, i) => (
                <div key={p.id}>
                {(i === 0 || game.players[i - 1].teamId !== p.teamId) && (
                  <div className="label sticky top-0 z-10 bg-ink-900/95 px-2 py-1.5 backdrop-blur">{p.team?.fullName ?? p.teamId}</div>
                )}
                <button
                  key={p.id}
                  onClick={() => setPlayerId(p.id)}
                  className={cx("flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left transition", p.id === playerId ? "border-ai/50 bg-ai/10" : "border-transparent hover:bg-ink-850")}
                >
                  <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="sm" ringColor={p.team?.colors.primary} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm text-ink-100">
                      {p.name}
                      {linesByPlayer.has(p.id) && <span className="rounded bg-brand/25 px-1 text-[9px] font-bold uppercase text-brand-light" title="Has PrizePicks lines">PP</span>}
                    </span>
                    <span className="block text-[11px] text-ink-400">
                      {p.team?.abbreviation} · {p.position}
                      {p.injury && <span className="ml-1 text-warn">· {p.injury.status}</span>}
                    </span>
                  </span>
                </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {player && (
          <div className="space-y-3">
            {playerLines.length > 0 && (
              <div>
                <div className="label mb-2">PrizePicks lines for {player.lastName}</div>
                <div className="flex flex-wrap gap-1.5">
                  {playerLines.map((l) => {
                    const label = stats.find((s) => s.key === l.statKey)?.label ?? l.statKey;
                    return (
                      <button
                        key={l.statKey}
                        onClick={() => {
                          setStatKey(l.statKey);
                          setThreshold("");
                        }}
                        className={cx("chip", l.statKey === statKey && "chip-active")}
                      >
                        <span className="num font-semibold">{l.line}</span> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <label className="label mb-2 block" htmlFor="stat">3 · Statistic</label>
              <select id="stat" className="input" value={statKey} onChange={(e) => setStatKey(e.target.value)}>
                {stats.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label mb-2 block" htmlFor="threshold">4 · Hypothetical threshold (optional)</label>
              <input
                id="threshold"
                className="input"
                inputMode="decimal"
                placeholder={currentLine ? `Auto: PrizePicks line ${currentLine.line}` : "Auto: typical line (median of last 10 games)"}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
              />
            </div>
            <button className="btn btn-primary w-full" onClick={run} disabled={loading}>
              {loading ? "Running model…" : result ? "Update forecast" : "Generate forecast"}
            </button>
          </div>
        )}
      </div>
      <div className="card card-pad min-h-[400px] self-start xl:sticky xl:top-32">
        {error && <ErrorNote>{error}</ErrorNote>}
        {loading && !result && (
          <div className="space-y-4">
            <div className="flex items-center gap-4"><div className="skeleton h-24 w-24 rounded-full" /><div className="flex-1 space-y-2"><div className="skeleton h-5 w-1/2" /><div className="skeleton h-4 w-1/3" /></div></div>
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-40 w-full" />
          </div>
        )}
        {result && <div className={cx(loading && "opacity-60 transition-opacity")}><ForecastView data={result} /></div>}
        {!result && !loading && !error && (
          <div className="flex flex-col items-center pt-16 text-center">
            <div className="mb-2 text-sm font-medium text-ink-100">Choose a game, player and statistic</div>
            <p className="max-w-md text-xs text-ink-400">
              The engine blends recent form, season and career rates, then adjusts for opponent allowance, venue, playing time, head-to-head history and availability. Output: projection, probability above/below a hypothetical threshold, confidence, evidence and data freshness.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
