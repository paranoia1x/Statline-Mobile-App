import { useState } from "react";
import { loadModel, provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { getStore } from "@/lib/store";
import { summarizePredictions, type CalibrationBin } from "@/lib/engine/evaluation";
import { gradePendingForUser } from "@/lib/server/grading";
import { playersVM, teamMap } from "@/lib/server/lookups";
import { SPORTS, statDef } from "@/lib/sports";
import { teamVM } from "@/lib/view";
import { labelFor } from "@/lib/engine/verdict";
import { cx, fmtDate, pct } from "@/lib/format";
import { CalibrationChart, TrendChart } from "@/components/charts";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { GradeNow, WithdrawPrediction } from "@/components/TrackerControls";
import { ListCard, Loading, Section } from "@/components/mobile";
import { Badge, ConfidencePill, EmptyState, KPI, SportTag, VerdictBadge } from "@/components/ui";

const toPoints = (bins: CalibrationBin[]) =>
  bins.filter((b) => b.count > 0).map((b) => ({ bin: `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`, predicted: b.avgPredicted!, observed: b.observed!, count: b.count }));
const STATUS_TONE = { correct: "pos", incorrect: "neg", pending: "blue", push: "neutral", void: "neutral" } as const;

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; n: number; correct: number; accuracy: number | null }[] }) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <ListCard>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
            <span className="text-ink-200">{r.label}</span>
            <span className="num text-ink-400">{r.correct}/{r.n} · <span className="text-white">{pct(r.accuracy, 1)}</span></span>
          </div>
        ))}
      </ListCard>
    </Section>
  );
}

export default function Tracker() {
  const [sport] = useSport();
  const [status, setStatus] = useState("");
  const d = useData(async () => {
    await gradePendingForUser("local");
    const all = (await getStore().listPredictions()).filter((p) => !sport || p.sport === sport);
    const pids = [...new Set(all.map((p) => p.playerId).filter((x): x is string => !!x))];
    const players = new Map((await playersVM((await Promise.all(pids.map((id) => provider.getPlayer(id)))).filter((x): x is NonNullable<typeof x> => !!x))).map((p) => [p.id, p]));
    const teams = await teamMap();
    const backtests = (await loadModel()).filter((b) => !sport || b.sport === sport);
    return { all, summary: summarizePredictions(all), players, teams, backtests };
  }, [sport], { watchStore: true });
  if (!d.data) return <Loading rows={3} />;
  const { all, summary, players, teams, backtests } = d.data;
  const list = all.filter((p) => !status || p.status === status);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400">Every tracked forecast, graded against final stats. Misses are never hidden.</p>
        <GradeNow />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <KPI label="Tracked" value={summary.total} />
        <KPI label="Hit" value={summary.correct} tone="pos" />
        <KPI label="Missed" value={summary.incorrect} tone="neg" />
        <KPI label="Pending" value={summary.pending} />
        <KPI label="Accuracy" value={pct(summary.accuracy, 1)} tone="ai" />
        <KPI label="Brier" value={summary.brier == null ? "—" : summary.brier.toFixed(3)} sub="lower = better" />
      </div>

      <Section title="History">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {["", "pending", "correct", "incorrect", "push", "void"].map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cx("chip shrink-0", status === s && "chip-active")}>
              {s === "correct" ? "Hit" : s === "incorrect" ? "Missed" : s ? s[0].toUpperCase() + s.slice(1) : "All"}
            </button>
          ))}
        </div>
        {list.length ? (
          <ListCard>
            {list.map((p) => {
              const pl = p.playerId ? players.get(p.playerId) : null;
              const opp = p.opponentId ? teams.get(p.opponentId) : null;
              const team = p.teamId ? teams.get(p.teamId) : null;
              const desc =
                p.kind === "player_stat"
                  ? `${statDef(p.sport, p.statKey!)?.label ?? p.statKey} ${p.side === "over" ? "over" : "under"} ${p.threshold}`
                  : p.kind === "game_total"
                    ? `Game total ${p.side === "over" ? "over" : "under"} ${p.threshold}`
                    : p.side === "draw" ? "Draw" : `${team?.abbreviation} win`;
              return (
                <div key={p.id} className="px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    {pl ? <PlayerAvatar name={pl.name} imageUrl={pl.imageUrl} size="sm" ringColor={pl.team?.colors.primary} /> : team && <TeamLogo abbreviation={team.abbreviation} name={team.fullName} logoUrl={teamVM(team).logoUrl} colors={team.colors} size="sm" />}
                    <a href={`#/matchups/${p.gameId}`} className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink-100">{pl ? pl.name : `${team?.abbreviation} vs ${opp?.abbreviation}`}</div>
                      <div className="truncate text-[11px] text-ink-400">{desc} · {fmtDate(p.gameDate)}</div>
                    </a>
                    <div className="text-right">
                      <Badge tone={STATUS_TONE[p.status]}>{p.status === "correct" ? "Hit ✓" : p.status === "incorrect" ? "Miss ✕" : p.status}</Badge>
                      {p.actual != null && <div className="num mt-0.5 text-[11px] text-ink-400">actual {p.actual}</div>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-11">
                    <SportTag sport={p.sport} />
                    <span className="num text-[11px] text-ink-300">{pct(p.probability, 1)}</span>
                    <VerdictBadge label={labelFor(p.probability, p.confidence)} />
                    <ConfidencePill level={p.confidence} />
                    {p.status === "pending" && <span className="ml-auto"><WithdrawPrediction id={p.id} /></span>}
                  </div>
                </div>
              );
            })}
          </ListCard>
        ) : (
          <EmptyState title={all.length ? "Nothing with this status" : "No tracked forecasts yet"} body="Use “Track” on Top Plays, AI Predictions or a matchup." action={<a href="#/plays" className="btn">See Top Plays</a>} />
        )}
      </Section>

      <Breakdown title="By AI verdict" rows={summary.byVerdict} />
      <Breakdown title="By sport" rows={summary.bySport} />
      <Breakdown title="By statistic" rows={summary.byStat} />
      <Breakdown title="By confidence" rows={summary.byConfidence} />

      {summary.timeline.length > 1 && (
        <Section title="Accuracy over time">
          <div className="card p-3">
            <TrendChart data={summary.timeline.map((t) => ({ label: fmtDate(t.date), accuracy: t.cumulativeAccuracy }))} series={[{ key: "accuracy", name: "Cumulative accuracy" }]} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        </Section>
      )}
      {summary.bins.some((b) => b.count > 0) && (
        <Section title="Your calibration">
          <div className="card p-3"><CalibrationChart points={toPoints(summary.bins)} /></div>
        </Section>
      )}

      <Section title="Model backtest">
        <ListCard>
          {backtests.map((b) => (
            <div key={b.sport} className="px-3.5 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-100">{SPORTS[b.sport].name}</span>
                <span className="num text-white">{pct(b.metrics.accuracy, 1)}</span>
              </div>
              <div className="num mt-0.5 text-[11px] text-ink-400">
                {b.metrics.n.toLocaleString()} games · Brier {b.metrics.brierRaw?.toFixed(3)} → {b.metrics.brierCalibrated?.toFixed(3)} · high-conf {pct(b.byConfidence.high?.accuracy ?? null, 1)}
              </div>
            </div>
          ))}
        </ListCard>
        <p className="px-1 text-[11px] text-ink-500">Walk-forward: each game forecast using only earlier data. A Brier score of 0.250 equals always guessing 50%.</p>
      </Section>
    </div>
  );
}
