"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

/*
 * Chart conventions (dark surface): single hue for magnitude (series-1 blue),
 * second categorical slot (orange) only for a second entity, status green/red
 * reserved for above/below a threshold. Gridlines and axes stay recessive.
 */
// theme-aware: values resolve from CSS variables (src/app/themes.css)
const C = { s1: "#3987e5", s2: "#d95926", pos: "rgb(var(--pos))", neg: "rgb(var(--neg))", grid: "var(--grid)", axis: "var(--axis)", text: "var(--chart-text)", muted: "rgb(var(--ink-500))" };
const axisProps = { stroke: C.axis, tick: { fill: C.axis, fontSize: 11 }, tickLine: false, axisLine: { stroke: C.grid } } as const;

function TipBox({ title, rows }: { title?: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900/95 px-3 py-2 text-xs shadow-xl">
      {title && <div className="mb-1 font-medium text-ink-100">{title}</div>}
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-ink-400">{k}</span>
          <span className="num text-ink-100">{v}</span>
        </div>
      ))}
    </div>
  );
}

export interface GameLogPoint {
  label: string; // e.g. "Nov 12"
  opponent: string;
  value: number;
  home: boolean;
}

/** Per-game values as bars, colored by whether they cleared the threshold. */
export function GameLogChart({ data, threshold, statLabel, height = 220 }: { data: GameLogPoint[]; threshold?: number | null; statLabel: string; height?: number }) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-sm text-ink-400">No completed games in this window.</div>;
  return (
    <div style={{ height }} role="img" aria-label={`${statLabel} by game`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ fill: "var(--hover-tint)" }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <TipBox
                  title={`${(payload[0].payload as GameLogPoint).home ? "vs" : "@"} ${(payload[0].payload as GameLogPoint).opponent} · ${(payload[0].payload as GameLogPoint).label}`}
                  rows={[[statLabel, String((payload[0].payload as GameLogPoint).value)], ...(threshold != null ? ([["Threshold", String(threshold)]] as [string, string][]) : [])]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500}>
            {data.map((d, i) => (
              <Cell key={i} fill={threshold == null ? C.s1 : d.value > threshold ? C.pos : d.value < threshold ? C.neg : C.muted} fillOpacity={0.85} />
            ))}
          </Bar>
          {threshold != null && <ReferenceLine y={threshold} stroke={C.text} strokeDasharray="4 4" label={{ value: `${threshold}`, position: "right", fill: C.text, fontSize: 11 }} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  [k: string]: number | string | null;
}

/** One or two line series sharing one axis (never dual-axis). */
export function TrendChart({
  data,
  series,
  height = 220,
  yLabel,
  format = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)),
}: {
  data: SeriesPoint[];
  series: { key: string; name: string }[];
  height?: number;
  yLabel?: string;
  format?: (v: number) => string;
}) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-sm text-ink-400">Not enough data to chart.</div>;
  const colors = [C.s1, C.s2];
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex gap-4 text-xs text-ink-300">
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: colors[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div style={{ height }} role="img" aria-label={yLabel ?? series.map((s) => s.name).join(", ")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
            <YAxis {...axisProps} width={40} tickFormatter={(v) => format(Number(v))} />
            <Tooltip
              cursor={{ stroke: C.axis, strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox title={String(label)} rows={payload.map((p) => [String(p.name), p.value == null ? "—" : format(Number(p.value))])} />
                ) : null
              }
            />
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={colors[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "rgb(var(--ink-900))", strokeWidth: 2 }} connectNulls animationDuration={500} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Forecast outcome distribution with the threshold marked. */
export function DistributionChart({ pmf, threshold, mean, sd, kind }: { pmf?: number[]; threshold: number; mean: number; sd: number; kind: "count" | "continuous" }) {
  let data: { x: number; p: number }[];
  if (kind === "count" && pmf) data = pmf.map((p, x) => ({ x, p }));
  else {
    const lo = Math.max(0, mean - 3 * sd);
    const hi = mean + 3 * sd;
    const step = (hi - lo) / 40;
    data = Array.from({ length: 41 }, (_, i) => {
      const x = lo + i * step;
      const p = Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
      return { x: Math.round(x * 10) / 10, p: p * step };
    });
  }
  return (
    <div style={{ height: 160 }} role="img" aria-label="Projected outcome distribution">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
          <XAxis dataKey="x" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
          <YAxis {...axisProps} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} width={40} />
          <Tooltip
            cursor={{ fill: "var(--hover-tint)" }}
            content={({ active, payload }) =>
              active && payload?.[0] ? <TipBox rows={[["Outcome", String(payload[0].payload.x)], ["Probability", `${(payload[0].payload.p * 100).toFixed(1)}%`]]} /> : null
            }
          />
          <Bar dataKey="p" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.x > threshold ? C.pos : d.x < threshold ? C.neg : C.muted} fillOpacity={0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CalPoint {
  bin: string;
  predicted: number;
  observed: number;
  count: number;
}

/** Reliability diagram: predicted probability vs observed frequency; diagonal = perfect calibration. */
export function CalibrationChart({ points, height = 240 }: { points: CalPoint[]; height?: number }) {
  if (!points.length) return <div className="flex h-40 items-center justify-center text-sm text-ink-400">No graded predictions yet — calibration appears once results are in.</div>;
  return (
    <div style={{ height }} role="img" aria-label="Calibration: predicted vs observed">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="predicted" domain={[0.5, 1]} {...axisProps} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "Predicted", position: "insideBottom", offset: -8, fill: C.axis, fontSize: 11 }} />
          <YAxis type="number" dataKey="observed" domain={[0, 1]} {...axisProps} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={48} />
          <ZAxis type="number" dataKey="count" range={[60, 360]} />
          <ReferenceLine segment={[{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }]} stroke={C.axis} strokeDasharray="4 4" />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <TipBox
                  title={`Bin ${(payload[0].payload as CalPoint).bin}`}
                  rows={[
                    ["Avg predicted", `${((payload[0].payload as CalPoint).predicted * 100).toFixed(1)}%`],
                    ["Observed", `${((payload[0].payload as CalPoint).observed * 100).toFixed(1)}%`],
                    ["Predictions", String((payload[0].payload as CalPoint).count)],
                  ]}
                />
              ) : null
            }
          />
          <Scatter data={points} fill={C.s1} stroke="rgb(var(--ink-900))" strokeWidth={2} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars comparing two teams (a = away, orange; b = home, blue), values as league percentiles. */
export function PercentileCompare({ rows, aName, bName }: { rows: { label: string; a: number | null; b: number | null; aText: string; bText: string }[]; aName: string; bName: string }) {
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-300">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: C.s2 }} />{aName}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: C.s1 }} />{bName}</span>
        <span className="ml-auto text-ink-500">League percentile (100 = best)</span>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="num text-ink-200">{r.aText}</span>
              <span className="text-ink-400">{r.label}</span>
              <span className="num text-ink-200">{r.bText}</span>
            </div>
            <div className="grid grid-cols-2 gap-[2px]">
              <div className="flex h-2 justify-end overflow-hidden rounded-l bg-ink-800" title={`${aName}: ${r.a ?? "—"} percentile`}>
                <div className="h-full rounded-l" style={{ width: `${r.a ?? 0}%`, background: C.s2 }} />
              </div>
              <div className="h-2 overflow-hidden rounded-r bg-ink-800" title={`${bName}: ${r.b ?? "—"} percentile`}>
                <div className="h-full rounded-r" style={{ width: `${r.b ?? 0}%`, background: C.s1 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
