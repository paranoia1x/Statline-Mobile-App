import { useEffect, useMemo, useState } from "react";
import { loadFantasyModel } from "@/boot";
import { useData, useSport } from "@/hooks";
import { getFantasyBoard, projectedStatLine, type FantasyRow } from "@/lib/fantasy/board";
import { getFormat, formatsFor } from "@/lib/fantasy/formats";
import { SPORTS } from "@/lib/sports";
import type { SportId } from "@/lib/types";
import { cx, fmtDate } from "@/lib/format";
import { AccuracyNote, FantasyRowCard, SlateGameCard, StatLine } from "@/components/fantasy";
import { Carousel, Disclaimer, ErrorBox, Loading, Section, Segmented } from "@/components/mobile";
import { EmptyState } from "@/components/ui";

const FORMAT_KEY = "sl.fantasyFormat";
const PAGE = 40;

function readFormats(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FORMAT_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Sport shown when the global filter is "All": the first one with games this week. */
const DEFAULT_SPORT: SportId = "nfl";

export default function Fantasy({ query }: { query: URLSearchParams }) {
  const [globalSport] = useSport();
  const sport: SportId = globalSport ?? DEFAULT_SPORT;
  const [formats, setFormats] = useState(readFormats);
  const formatId = getFormat(formats[sport], sport).id;
  const [slate, setSlate] = useState<string | null>(null);
  const [group, setGroup] = useState<string>(query.get("pos") ?? "ALL");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setSlate(null);
    setGroup("ALL");
    setOpen(null);
  }, [sport]);
  useEffect(() => setLimit(PAGE), [sport, formatId, slate, group, q]);

  const board = useData(() => getFantasyBoard(sport, formatId, slate), [sport, formatId, slate]);
  const model = useData(loadFantasyModel, []);
  const accuracy = model.data?.accuracy.find((a) => a.sport === sport && a.format === formatId) ?? model.data?.accuracy.find((a) => a.sport === sport);

  const setFormat = (id: string) => {
    const next = { ...formats, [sport]: id };
    setFormats(next);
    try {
      localStorage.setItem(FORMAT_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const rows = useMemo(() => {
    const all = board.data?.rows ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r) => (group === "ALL" || r.group === group) && (!needle || r.player.name.toLowerCase().includes(needle) || r.team.abbreviation.toLowerCase() === needle || r.team.name.toLowerCase().includes(needle)),
    );
  }, [board.data, group, q]);

  const fmts = formatsFor(sport);
  const b = board.data;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand-deep/45 via-ink-900 to-ink-900 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Fantasy projections</div>
        <div className="mt-1 text-xl font-semibold text-white">
          {SPORTS[sport].name} · {b?.slates.find((s) => s.id === b.slate)?.label ?? "Upcoming"}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-300">
          Projected fantasy points for every starter, built from recent form, defense vs position, the betting-market team total{sport === "nfl" ? ", weather" : ""} and injuries. Tap a player to see why.
        </p>
        {!globalSport && <p className="mt-1 text-[11px] text-ink-400">Showing NFL — pick another sport above.</p>}
        {fmts.length > 1 && (
          <div className="mt-3">
            <Segmented value={formatId} options={fmts.map((f) => ({ id: f.id, label: f.short }))} onChange={setFormat} />
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-400">{getFormat(formatId, sport).note}</p>
      </section>

      <AccuracyNote a={accuracy} />

      {board.error ? (
        <ErrorBox message={board.error} />
      ) : !b ? (
        <Loading rows={4} />
      ) : !b.slate ? (
        <EmptyState title={`No ${SPORTS[sport].name} games in the next week`} body="Projections appear once the schedule has upcoming games. Try another sport." />
      ) : (
        <>
          {b.slates.length > 1 && (
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Game day">
              {b.slates.map((s) => (
                <button key={s.id} role="tab" aria-selected={s.id === b.slate} onClick={() => setSlate(s.id)} className={cx("chip shrink-0 px-3 py-1.5", s.id === b.slate && "chip-active")}>
                  {s.label} <span className="text-ink-400">· {s.games}</span>
                </button>
              ))}
            </div>
          )}

          <Section title="Games" action={<span className="text-ink-400">Team totals · O/D = offense / defense rank</span>}>
            <Carousel>
              {b.games.map((g) => (
                <SlateGameCard key={g.id} g={g} />
              ))}
            </Carousel>
          </Section>

          <Section title="Rankings" action={<span className="text-ink-400">{rows.length} players</span>}>
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Position">
              {[{ id: "ALL", label: "All" }, ...b.groups].map((g) => (
                <button key={g.id} role="tab" aria-selected={group === g.id} onClick={() => setGroup(g.id)} className={cx("chip shrink-0 px-3.5 py-1.5", group === g.id && "chip-active")}>
                  {g.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a player or team"
              aria-label="Find a player or team"
              className="input w-full"
            />
            {rows.length ? (
              <div className="space-y-2">
                {rows.slice(0, limit).map((r) => (
                  <FantasyRowCard key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} extra={open === r.id ? <RowStatLine row={r} formatId={formatId} /> : null} />
                ))}
                {rows.length > limit && (
                  <button className="btn w-full" onClick={() => setLimit(limit + PAGE)}>
                    Show more ({rows.length - limit} left)
                  </button>
                )}
              </div>
            ) : (
              <EmptyState title="No players match" body="Try another position or clear the search." />
            )}
          </Section>

          <HowItWorks sport={sport} formatId={formatId} generatedAt={b.generatedAt} />
        </>
      )}
      <Disclaimer />
    </div>
  );
}

function RowStatLine({ row, formatId }: { row: FantasyRow; formatId: string }) {
  const line = useData(() => projectedStatLine(row, formatId), [row.id, formatId]);
  if (!line.data?.length) return null;
  return (
    <div>
      <div className="label mb-1.5">Projected stat line</div>
      <StatLine items={line.data} />
    </div>
  );
}

function HowItWorks({ sport, formatId, generatedAt }: { sport: SportId; formatId: string; generatedAt: string }) {
  const f = getFormat(formatId, sport);
  return (
    <details className="card overflow-hidden">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-ink-100">
        How projections and scoring work
        <span className="text-ink-400">+</span>
      </summary>
      <div className="space-y-3 border-t border-ink-800 px-4 py-3 text-xs leading-relaxed text-ink-300">
        <p>
          Each player's fantasy points are rebuilt game by game from box scores. The projection starts from recent form and the season average, then adjusts for
          playing-time trends, the <b className="text-ink-100">defense vs position</b> (how many fantasy points the opponent allows to that position),
          the <b className="text-ink-100">game environment</b> (the team's expected score from the betting line, or the team model when there's no line yet){sport === "nfl" ? ", game-time wind, rain, snow and cold at outdoor stadiums" : ""}
          {sport === "nba" || sport === "nhl" ? ", back-to-backs" : ""}, injuries and key teammates who are out.
        </p>
        <p>
          The strength of each adjustment was chosen on a walk-forward backtest: past games were projected using only data from before each game, and the
          settings that missed actual scores by the least on older games were checked on the most recent games.
        </p>
        <p>Floor and ceiling are roughly the player's 10th and 90th percentile outcomes. Ranks: O = team offense (points scored), D = defense (points allowed); #1 is best.</p>
        {sport === "nfl" && <p>Weather effects (wind above 10 mph, rain or snow, below 25°F) follow published research rather than this app's data, and are halved when a betting line already prices the forecast.</p>}
        <div>
          <div className="label mb-1">{f.label} scoring</div>
          <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {[...new Set(f.groups.flatMap((g) => f.rules(g).map((r) => `${r.label}|${r.pts}`)))].map((x) => {
              const [label, pts] = x.split("|");
              return (
                <li key={x} className="flex justify-between gap-3 border-b border-ink-800/60 py-1">
                  <span>{label}</span>
                  <span className="num text-ink-100">{Number(pts) > 0 ? "+" : ""}{pts}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-ink-500">Computed {fmtDate(generatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} from the latest stats snapshot.</p>
      </div>
    </details>
  );
}
