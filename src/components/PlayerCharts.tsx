"use client";

import { useMemo, useState } from "react";
import { GameLogChart, TrendChart } from "./charts";
import { cx } from "@/lib/format";

export interface LogRow {
  date: string;
  label: string;
  opp: string;
  home: boolean;
  minutes: number;
  season: string;
  stats: Record<string, number>;
}
export interface StatOpt {
  key: string;
  label: string;
  short: string;
  ratio: boolean;
}

const WINDOWS = [
  { id: "10", label: "Last 10" },
  { id: "20", label: "Last 20" },
  { id: "season", label: "Season" },
  { id: "all", label: "All" },
];

export function PlayerCharts({ logs, stats, playingTimeLabel, usageKey, usageLabel }: { logs: LogRow[]; stats: StatOpt[]; playingTimeLabel: string; usageKey?: string | null; usageLabel?: string | null }) {
  const charted = stats.filter((s) => !s.ratio);
  const [stat, setStat] = useState(charted[0]?.key ?? "");
  const [win, setWin] = useState("20");
  const [threshold, setThreshold] = useState("");
  const season = logs.length ? logs[logs.length - 1].season : "";
  const rows = useMemo(() => {
    if (win === "season") return logs.filter((l) => l.season === season);
    if (win === "all") return logs;
    return logs.slice(-Number(win));
  }, [logs, win, season]);
  const def = charted.find((s) => s.key === stat);
  const th = threshold.trim() === "" ? null : Number(threshold);
  const data = rows.filter((r) => typeof r.stats[stat] === "number").map((r) => ({ label: r.label, opponent: r.opp, value: r.stats[stat], home: r.home }));
  const avg = data.length ? data.reduce((a, b) => a + b.value, 0) / data.length : null;
  const hits = th != null && Number.isFinite(th) ? data.filter((d) => d.value > th).length : null;
  const timeData = rows.map((r) => ({ label: r.label, minutes: r.minutes, ...(usageKey ? { usage: r.stats[usageKey] ?? null } : {}) }));

  if (!logs.length) return <div className="py-10 text-center text-sm text-ink-400">No completed games yet.</div>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select value={stat} onChange={(e) => setStat(e.target.value)} className="input w-auto" aria-label="Statistic">
          {charted.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="flex gap-1" role="tablist" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w.id} role="tab" aria-selected={win === w.id} onClick={() => setWin(w.id)} className={cx("chip", win === w.id && "chip-active")}>
              {w.label}
            </button>
          ))}
        </div>
        <input
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          inputMode="decimal"
          placeholder="Hypothetical threshold"
          className="input w-48"
          aria-label="Hypothetical threshold"
        />
      </div>
      <div className="flex flex-wrap gap-6 text-xs text-ink-400">
        <span>
          Average <span className="num ml-1 text-sm text-white">{avg == null ? "—" : avg.toFixed(2)}</span>
        </span>
        <span>
          Games <span className="num ml-1 text-sm text-white">{data.length}</span>
        </span>
        {hits != null && (
          <span>
            Above {th} <span className="num ml-1 text-sm text-white">{hits}/{data.length}</span>
            <span className="ml-1 text-ink-500">(small samples are noisy)</span>
          </span>
        )}
      </div>
      <GameLogChart data={data} threshold={th != null && Number.isFinite(th) ? th : null} statLabel={def?.label ?? stat} />
      <div>
        <div className="label mb-2">{playingTimeLabel}{usageKey ? ` & ${usageLabel}` : ""}</div>
        <TrendChart
          data={timeData}
          series={[{ key: "minutes", name: playingTimeLabel }, ...(usageKey ? [{ key: "usage", name: usageLabel ?? "Usage" }] : [])]}
          height={180}
        />
      </div>
    </div>
  );
}
