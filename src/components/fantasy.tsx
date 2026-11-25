import type { ReactNode } from "react";
import { cx, fmtDateTime, pct } from "@/lib/format";
import type { FantasyRow, Grade, SlateGame, StatLineItem, Tier } from "@/lib/fantasy/board";
import { ordinal } from "@/lib/fantasy/engine";
import type { FantasyAccuracy } from "@/lib/fantasy/backtest";
import { weatherText } from "@/lib/fantasy/engine";
import { PlayerAvatar, TeamLogo } from "./media";
import { Badge } from "./ui";

const GRADE_CLS: Record<Grade, string> = {
  Great: "border-pos/40 bg-pos/15 text-pos",
  Good: "border-pos/25 bg-pos/10 text-pos",
  Neutral: "border-ink-600 bg-ink-800 text-ink-200",
  Tough: "border-neg/25 bg-neg/10 text-neg",
  "Very tough": "border-neg/40 bg-neg/15 text-neg",
};
export function GradePill({ grade, className }: { grade: Grade; className?: string }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold", GRADE_CLS[grade], className)}>{grade}</span>;
}

const TIER_TONE: Record<Tier, "pos" | "blue" | "neutral" | "neg" | "ai"> = { Start: "pos", Top: "pos", Flex: "blue", Solid: "blue", Bench: "neutral", Fringe: "neutral", Out: "neg" };
export function TierBadge({ tier }: { tier: Tier }) {
  return <Badge tone={TIER_TONE[tier]}>{tier}</Badge>;
}

const rankTone = (rank: number | null, of: number) => (rank == null || !of ? "text-ink-300" : rank <= of / 4 ? "text-pos" : rank > (of * 3) / 4 ? "text-neg" : "text-ink-200");

/** "#4" with good/bad colouring (1 = best). */
export function RankText({ rank, of, label }: { rank: number | null; of: number; label: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-ink-400">{label} </span>
      <span className={cx("num font-semibold", rankTone(rank, of))}>{rank ? `#${rank}` : "—"}</span>
    </span>
  );
}

export function WeatherChip({ weather, indoor }: { weather: SlateGame["weather"]; indoor: boolean | null }) {
  if (indoor) return <span className="text-[11px] text-ink-400">Dome</span>;
  if (!weather) return null;
  const windy = (weather.windMph ?? 0) >= 15;
  const wet = /rain|snow|shower|storm/i.test(weather.condition) || (weather.precipChance ?? 0) >= 60;
  return (
    <span className={cx("text-[11px]", windy || wet ? "font-medium text-warn" : "text-ink-400")} title={weatherText(weather)}>
      {weather.temperatureF != null ? `${Math.round(weather.temperatureF)}°` : ""}
      {weather.windMph != null ? ` · ${weather.windMph} mph` : ""}
      {wet ? " · wet" : ""}
    </span>
  );
}

/** Game card for the slate strip: implied team totals, offense/defense ranks and weather. */
export function SlateGameCard({ g }: { g: SlateGame }) {
  const side = (t: SlateGame["home"], implied: number | null, r: SlateGame["homeRank"]) => (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex min-w-0 items-center gap-2 text-sm text-ink-100">
        <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="xs" />
        <span className="font-medium">{t.abbreviation}</span>
        <span className="truncate text-[10.5px]">
          <RankText rank={r.offense} of={r.of} label="O" /> <RankText rank={r.defense} of={r.of} label="D" />
        </span>
      </span>
      <span className="num text-sm font-semibold text-white">{implied != null ? implied.toFixed(1) : "—"}</span>
    </div>
  );
  return (
    <a href={`#/matchups/${g.id}`} className="card w-[70vw] max-w-[260px] shrink-0 snap-start p-3 active:bg-ink-850">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-400">
        <span>{fmtDateTime(g.date)}</span>
        <WeatherChip weather={g.weather} indoor={g.indoor} />
      </div>
      {side(g.away, g.awayImplied, g.awayRank)}
      {side(g.home, g.homeImplied, g.homeRank)}
      <div className="mt-1.5 text-[10.5px] text-ink-500">
        {g.total != null ? `Total ${g.total}${g.spread != null ? ` · ${g.home.abbreviation} ${g.spread > 0 ? "+" : ""}${g.spread}` : ""} · implied team totals` : "No betting line yet · model team totals"}
      </div>
    </a>
  );
}

/** Horizontal bars for each adjustment's effect on the projection. */
export function ComponentBars({ row }: { row: FantasyRow }) {
  const items = row.components.filter((c) => c.key !== "baseline");
  return (
    <ul className="space-y-2">
      {items.map((c) => {
        const p = (c.effect - 1) * 100;
        const w = Math.min(50, Math.abs(p) * 2.5);
        return (
          <li key={c.key}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-200">{c.label}</span>
              <span className={cx("num font-semibold", p > 0.5 ? "text-pos" : p < -0.5 ? "text-neg" : "text-ink-400")}>{c.effect === 0 ? "out" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`}</span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-ink-800">
              <div className="absolute top-0 h-full w-px bg-ink-500" style={{ left: "50%" }} />
              <div className={cx("absolute top-0 h-full rounded-full", p >= 0 ? "bg-pos" : "bg-neg")} style={p >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-ink-400">{c.detail}</div>
          </li>
        );
      })}
    </ul>
  );
}

/** Last 10 games of fantasy points as small bars, with the projection marked. */
export function RecentBars({ row }: { row: FantasyRow }) {
  const xs = row.recent;
  if (!xs.length) return null;
  const max = Math.max(row.ceiling, ...xs.map((x) => x.fp), 1);
  const lineY = (row.points / max) * 100;
  return (
    <div>
      <div className="relative flex h-20 items-end gap-1">
        <div className="absolute inset-x-0 border-t border-dashed border-brand-bright/70" style={{ bottom: `${lineY}%` }} aria-hidden />
        {xs.map((x, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${x.fp.toFixed(1)} pts`}>
            <div className={cx("w-full rounded-t", x.fp >= row.points ? "bg-pos/70" : "bg-ink-600")} style={{ height: `${Math.max(3, (Math.max(0, x.fp) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-500">
        <span>Last {xs.length} games</span>
        <span>
          dashed line = projection {row.points.toFixed(1)} · green = beat it
        </span>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 text-[13px] leading-snug text-ink-100">{children}</div>
    </div>
  );
}

/** The key context numbers behind a projection. */
export function FactsGrid({ row }: { row: FantasyRow }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Fact label={`Defense vs ${row.groupLabel}`}>
        {row.matchup ? (
          <>
            <GradePill grade={row.matchup.grade} /> {row.matchup.allowed.toFixed(1)} pts/g
            <div className="text-[11px] text-ink-400">{ordinal(row.matchup.rankEasiest)} most allowed of {row.matchup.of}</div>
          </>
        ) : (
          "—"
        )}
      </Fact>
      <Fact label="Team total">
        {row.implied ? (
          <>
            <span className="num font-semibold">{row.implied.team.toFixed(1)}</span>
            <span className="text-ink-400"> vs usual {row.implied.usual.toFixed(1)}</span>
            <div className="text-[11px] text-ink-400">{row.implied.source === "market" ? "From the betting line" : "Team model (no line yet)"}</div>
          </>
        ) : (
          "—"
        )}
      </Fact>
      <Fact label={`${row.team.abbreviation} offense`}>
        <RankText rank={row.teamRank.offense} of={row.teamRank.of} label="Rank" />
        <div className="text-[11px] text-ink-400">{row.teamRank.scoreFor != null ? `${row.teamRank.scoreFor.toFixed(1)} scored / game` : ""}</div>
      </Fact>
      <Fact label={`${row.opponent.abbreviation} defense`}>
        <RankText rank={row.opponentRank.defense} of={row.opponentRank.of} label="Rank" />
        <div className="text-[11px] text-ink-400">{row.opponentRank.scoreAgainst != null ? `${row.opponentRank.scoreAgainst.toFixed(1)} allowed / game` : ""}</div>
      </Fact>
    </div>
  );
}

export function StatLine({ items }: { items: StatLineItem[] }) {
  if (!items.length) return null;
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
      {items.map((s) => (
        <div key={s.key} className="shrink-0 rounded-lg border border-ink-800 bg-ink-850 px-2.5 py-1.5 text-center">
          <div className="num text-sm font-semibold text-white">{s.value < 10 ? s.value.toFixed(1) : Math.round(s.value)}</div>
          <div className="text-[10px] text-ink-400">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** One projection row; tapping opens the details. */
export function FantasyRowCard({ row, open, onToggle, extra }: { row: FantasyRow; open: boolean; onToggle: () => void; extra?: ReactNode }) {
  const out = row.status === "out";
  const ringColor = row.team.colors.primary;
  return (
    <div className={cx("card overflow-hidden", out && "opacity-60")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-ink-850">
        <span className="num w-9 shrink-0 text-center text-[11px] font-semibold text-ink-400">
          {row.groupLabel}
          <span className="block text-sm text-ink-100">{row.rank}</span>
        </span>
        <PlayerAvatar name={row.player.name} imageUrl={row.player.imageUrl} size="sm" ringColor={ringColor} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-ink-100">{row.player.name}</span>
            {row.status && row.status !== "active" && <Badge tone={out ? "neg" : "warn"}>{row.status === "day-to-day" ? "DTD" : row.status.toUpperCase().slice(0, 4)}</Badge>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-400">
            <span className="truncate">
              {row.team.abbreviation} {row.home ? "vs" : "@"} {row.opponent.abbreviation}
            </span>
            {row.matchup && <GradePill grade={row.matchup.grade} />}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="num block text-lg font-semibold leading-tight text-white">{out ? "—" : row.points.toFixed(1)}</span>
          <span className="num block text-[10.5px] text-ink-400">{out ? "Out" : `${row.floor.toFixed(0)}–${row.ceiling.toFixed(0)}`}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-ink-800 px-3 pb-3 pt-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-300">
            <TierBadge tier={row.tier} />
            <span>
              {row.groupLabel}
              {row.rank} of {row.of}
            </span>
            <span>· {fmtDateTime(row.date)}</span>
            {row.seasonAvg != null && <span>· season {row.seasonAvg.toFixed(1)}</span>}
            {row.last5Avg != null && <span>· last 5 {row.last5Avg.toFixed(1)}</span>}
          </div>
          {row.injuryNote && <div className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">{row.status}: {row.injuryNote}</div>}
          {extra}
          <FactsGrid row={row} />
          <RecentBars row={row} />
          <div>
            <div className="label mb-2">What moves the projection</div>
            <ComponentBars row={row} />
          </div>
          {!row.id.endsWith("-dst") && (
            <a href={`#/players/${row.id}`} className="btn w-full">Player page →</a>
          )}
        </div>
      )}
    </div>
  );
}

export function AccuracyNote({ a }: { a: FantasyAccuracy | null | undefined }) {
  if (!a || !a.n || !Number.isFinite(a.mae)) return null;
  const gain = a.maeSeason > 0 ? 1 - a.mae / a.maeSeason : 0;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-ink-500">Average miss</div>
        <div className="num mt-0.5 text-lg font-semibold text-white">{a.mae.toFixed(1)} pts</div>
        <div className="text-[11px] leading-snug text-ink-400">
          {gain > 0 ? `${pct(gain)} closer than season averages (${a.maeSeason.toFixed(1)})` : `Season averages: ${a.maeSeason.toFixed(1)}`}
        </div>
      </div>
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-ink-500">Start / sit calls</div>
        <div className="num mt-0.5 text-lg font-semibold text-white">{pct(a.startSit)}</div>
        <div className="text-[11px] leading-snug text-ink-400">Picked the higher scorer of two at a position (season averages: {pct(a.startSitSeason)})</div>
      </div>
    </div>
  );
}
