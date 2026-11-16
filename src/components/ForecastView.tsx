"use client";

import type { PlayerForecast, Evidence } from "@/lib/engine/player-forecast";
import type { TrackRecord, Verdict } from "@/lib/engine/verdict";
import { VerdictCard } from "./VerdictCard";
import type { GameVM, PlayerVM, TeamVM } from "@/lib/view";
import { DistributionChart, GameLogChart } from "./charts";
import { PlayerAvatar, TeamLogo } from "./media";
import { AiCallout, AvailabilityBadge, Badge, ConfidencePill, ProbabilityBar, Warning } from "./ui";
import { SaveToVault, TrackPrediction } from "./actions";
import { fmtDate, fmtDateTime } from "@/lib/format";

export interface ForecastPayload {
  forecast: PlayerForecast;
  narrative: { text: string; source: "claude" | "template" };
  verdict: Verdict;
  verdictNarrative: { text: string; source: "claude" | "template" };
  trackRecord: TrackRecord | null;
  line?: { source: string; origin: "imported" | "feed"; line: number } | null;
  player: PlayerVM;
  opponent: TeamVM;
  game: GameVM | null;
  teamAbbr: Record<string, string>;
}

function EvidenceList({ items, tone, empty }: { items: Evidence[]; tone: "pos" | "neg"; empty: string }) {
  if (!items.length) return <div className="text-xs text-ink-400">{empty}</div>;
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="flex gap-2 text-sm text-ink-200">
          <span className={tone === "pos" ? "text-pos" : "text-neg"} aria-hidden>
            {tone === "pos" ? "+" : "−"}
          </span>
          <span>
            {e.text} <span className="text-[10px] uppercase tracking-wider text-ink-500">{e.kind}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ForecastView({ data, compact = false }: { data: ForecastPayload; compact?: boolean }) {
  const { forecast: f, player, opponent, game } = data;
  const leanLabel = f.lean === "neutral" ? "No clear lean" : f.lean === "over" ? `Leans above ${f.threshold}` : `Leans below ${f.threshold}`;
  const scheduled = game?.status === "scheduled";
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="xl" ringColor={player.team?.colors.primary} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {f.sample.dataSource === "demo" && <Badge tone="warn">DEMO DATA</Badge>}
              <ConfidencePill level={f.confidence.level} score={f.confidence.score} />
              {player.injury && <AvailabilityBadge status={player.injury.status} description={player.injury.description} />}
            </div>
            <div className="mt-1 text-lg font-semibold text-white">{player.name}</div>
            <div className="flex items-center gap-2 text-sm text-ink-300">
              {player.team && <TeamLogo abbreviation={player.team.abbreviation} name={player.team.fullName} logoUrl={player.team.logoUrl} colors={player.team.colors} size="xs" />}
              {player.team?.abbreviation} {f.home ? "vs" : "@"}
              <TeamLogo abbreviation={opponent.abbreviation} name={opponent.fullName} logoUrl={opponent.logoUrl} colors={opponent.colors} size="xs" />
              {opponent.abbreviation}
              <span className="text-ink-500">·</span>
              {fmtDateTime(f.gameDate)}
            </div>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 md:ml-auto md:max-w-sm">
          <div className="rounded-lg border border-ai/30 bg-ai/[0.06] px-4 py-3">
            <div className="label">Projected {f.statLabel.toLowerCase()}</div>
            <div className="num mt-1 text-3xl font-semibold text-white">{f.projection.toFixed(1)}</div>
            <div className="num text-xs text-ink-400">
              80% range {f.interval80[0].toFixed(1)}–{f.interval80[1].toFixed(1)}
            </div>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-850 px-4 py-3">
            <div className="label">{data.line ? "PrizePicks line" : "Threshold"}</div>
            <div className="num mt-1 text-3xl font-semibold text-white">{f.threshold}</div>
            <div className="text-xs text-ink-400">
              {data.line ? (data.line.origin === "feed" ? "Live PrizePicks line" : "From your imported board") : f.thresholdIsDefault ? "Auto (nearest half-unit)" : "User supplied"}
            </div>
            <div className="text-xs text-ink-300">{leanLabel}</div>
          </div>
        </div>
      </div>

      <VerdictCard
        key={`${f.playerId}-${f.statKey}-${f.threshold}-${f.gameId}`}
        forecast={f}
        playerName={player.name}
        opponentName={opponent.fullName}
        initial={data.verdict}
        narrative={data.verdictNarrative}
        trackRecord={data.trackRecord}
        demo={f.sample.dataSource === "demo"}
        pickem={!!data.line}
      />

      <ProbabilityBar pOver={f.pOver} pUnder={f.pUnder} pPush={f.pPush} threshold={f.threshold} />
      <div className="text-[11px] text-ink-400">
        Probabilities {f.calibration ? `are calibrated with a walk-forward backtest (logit slope ${f.calibration.slope}, ${f.calibration.samples} samples; raw P(above) ${(f.rawPOver * 100).toFixed(1)}%)` : "are uncalibrated (backtest unavailable)"}. Confidence reflects data reliability, not certainty of outcome.
      </div>

      {f.warnings.length > 0 && <div className="space-y-2">{f.warnings.map((w) => <Warning key={w}>{w}</Warning>)}</div>}

      <AiCallout title="Forecast explanation" source={data.narrative.source}>
        {data.narrative.text}
      </AiCallout>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-ink-700/70 p-4">
          <div className="label mb-3">Supporting evidence {f.lean !== "neutral" && `(${f.lean === "over" ? "above" : "below"})`}</div>
          <EvidenceList items={f.supporting} tone="pos" empty="No evidence on the leaning side." />
        </div>
        <div className="rounded-lg border border-ink-700/70 p-4">
          <div className="label mb-3">Conflicting evidence</div>
          <EvidenceList items={f.conflicting} tone="neg" empty="No conflicting evidence found." />
        </div>
      </div>

      {!compact && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-ink-700/70 p-4">
            <div className="label mb-2">Outcome distribution</div>
            <DistributionChart pmf={f.distribution.pmf} threshold={f.threshold} mean={f.distribution.mean} sd={f.distribution.sd} kind={f.distribution.kind} />
            <div className="mt-1 text-[11px] text-ink-400">Green = above threshold, red = below. {f.distribution.kind === "count" ? "Negative-binomial" : "Normal"} model, mean {f.distribution.mean.toFixed(2)}, sd {f.distribution.sd.toFixed(2)}.</div>
          </div>
          <div className="rounded-lg border border-ink-700/70 p-4">
            <div className="label mb-2">Last {f.recentValues.length} games vs threshold</div>
            <GameLogChart
              height={190}
              statLabel={f.statLabel}
              threshold={f.threshold}
              data={f.recentValues.map((r) => ({ label: fmtDate(r.date), opponent: data.teamAbbr[r.opponentId] ?? "?", value: r.value, home: false }))}
            />
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-lg border border-ink-700/70 p-4 lg:col-span-2">
          <div className="label mb-2">Model components</div>
          <div className="scrollbar-thin overflow-x-auto">
          <table className="table-base">
            <tbody>
              {f.components.map((c) => (
                <tr key={c.label} title={c.note}>
                  <td className="text-ink-200">{c.label}</td>
                  <td className="!whitespace-normal text-ink-300">{c.value}</td>
                  <td className={`num text-right ${c.effect > 1.005 ? "text-pos" : c.effect < 0.995 ? "text-neg" : "text-ink-400"}`}>×{c.effect.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {f.context.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="label">Context</div>
              {f.context.map((c) => (
                <div key={c} className="text-xs text-ink-300">• {c}</div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-ink-700/70 p-4 text-sm">
          <div className="label mb-2">Sample size & freshness</div>
          <dl className="space-y-1.5 text-ink-300">
            <div className="flex justify-between"><dt>Games used</dt><dd className="num text-white">{f.sample.games}</dd></div>
            <div className="flex justify-between"><dt>This season</dt><dd className="num text-white">{f.sample.seasonGames}</dd></div>
            <div className="flex justify-between"><dt>Vs opponent</dt><dd className="num text-white">{f.sample.h2hGames}</dd></div>
            <div className="flex justify-between"><dt>Last game</dt><dd className="num text-white">{f.sample.lastGameDate ? fmtDate(f.sample.lastGameDate) : "—"}</dd></div>
            <div className="flex justify-between"><dt>Days since</dt><dd className="num text-white">{f.sample.daysSinceLastGame ?? "—"}</dd></div>
            <div className="flex justify-between"><dt>Data source</dt><dd className="text-white">{f.sample.dataSource === "demo" ? "Demo (synthetic)" : "Live provider"}</dd></div>
            <div className="flex justify-between"><dt>Model</dt><dd className="num text-xs text-white">{f.modelVersion}</dd></div>
          </dl>
          <div className="mt-2 text-[11px] text-ink-400">Confidence factors: {f.confidence.reasons.join(", ")}.</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-800 pt-4">
        {game && scheduled ? (
          <>
            <TrackPrediction label={`Track: above ${f.threshold}`} body={{ kind: "player_stat", playerId: player.id, statKey: f.statKey, gameId: game.id, threshold: f.threshold, side: "over" }} />
            <TrackPrediction label={`Track: below ${f.threshold}`} body={{ kind: "player_stat", playerId: player.id, statKey: f.statKey, gameId: game.id, threshold: f.threshold, side: "under" }} />
          </>
        ) : (
          <span className="text-xs text-ink-400">This game is final — forecasts can only be tracked before games start.</span>
        )}
        <SaveToVault
          type="forecast"
          title={`${player.name} · ${f.statLabel} ${f.threshold} · ${fmtDate(f.gameDate)}`}
          sport={player.sport}
          refs={{ playerIds: [player.id], teamIds: [player.teamId, opponent.id], gameId: game?.id }}
          payload={{ forecast: { ...f, distribution: { ...f.distribution, pmf: undefined } }, narrative: data.narrative }}
          className="ml-auto"
        />
      </div>
    </div>
  );
}
