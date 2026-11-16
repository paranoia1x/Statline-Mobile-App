import type { Play } from "@/lib/server/top-plays";
import { cx, fmtDate, fmtTime, pct } from "@/lib/format";
import { PlayerAvatar, TeamLogo } from "./media";
import { Badge, ConfidencePill, SportTag } from "./ui";
import { TrackPrediction } from "./actions";

/** A Top Play: player, line, side, model probability, and (for past days) the result. */
export function PlayCard({ play: p, rank, compact = false }: { play: Play; rank?: number; compact?: boolean }) {
  const more = p.side === "over";
  const r = p.result;
  return (
    <div className={cx("card p-3.5", compact && "w-[78vw] max-w-[300px] shrink-0 snap-start")}>
      <div className="flex items-center gap-3">
        {rank != null && <span className="w-4 text-xs font-semibold text-ink-500">{rank}</span>}
        <a href={`#/players/${p.player.id}`} className="shrink-0">
          <PlayerAvatar name={p.player.name} imageUrl={p.player.imageUrl} size="md" ringColor={p.player.team?.colors.primary} />
        </a>
        <div className="min-w-0 flex-1">
          <a href={`#/players/${p.player.id}`} className="block truncate text-[15px] font-semibold text-white">{p.player.name}</a>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
            <SportTag sport={p.sport} />
            <span className="truncate">
              {p.player.team?.abbreviation} {p.home ? "vs" : "@"} {p.opponent.abbreviation} · {fmtDate(p.gameDate, { weekday: "short" })} {fmtTime(p.gameDate)}
            </span>
          </div>
        </div>
        <TeamLogo abbreviation={p.opponent.abbreviation} name={p.opponent.fullName} logoUrl={p.opponent.logoUrl} colors={p.opponent.colors} size="xs" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3 rounded-lg bg-ink-850 px-3 py-2.5">
        <div className="min-w-0">
          <div className={cx("text-[11px] font-bold uppercase tracking-wider", more ? "text-pos" : "text-neg")}>{more ? "More" : "Less"}</div>
          <div className="truncate text-base font-semibold text-white">
            <span className="num">{p.line}</span> {p.statLabel}
          </div>
          <div className="text-[10px] text-ink-500">{p.lineSource === "prizepicks" ? "PrizePicks line" : "Typical line (median of last 10)"}</div>
        </div>
        <div className="text-right">
          <div className="num text-2xl font-bold text-brand-light">{pct(p.probability)}</div>
          <div className="text-[10px] text-ink-400">model chance · proj {p.projection.toFixed(1)}</div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {r ? (
          <Badge tone={r.status === "hit" ? "pos" : r.status === "miss" ? "neg" : "neutral"}>
            {r.status === "hit" ? "✓ Hit" : r.status === "miss" ? "✗ Missed" : r.status === "push" ? "Push" : r.status === "void" ? "Void (didn't play)" : "Pending"}
            {r.actual != null && <span className="num opacity-80"> · {r.actual}</span>}
          </Badge>
        ) : (
          <>
            <Badge tone="pos">{p.label}</Badge>
            <ConfidencePill level={p.confidence.level} score={p.confidence.score} />
          </>
        )}
        {!r && !compact && (
          <span className="ml-auto flex items-center gap-2">
            <a href={`#/predictions?player=${p.player.id}&game=${p.gameId}&stat=${p.statKey}&threshold=${p.line}`} className="text-xs text-brand-light">Why →</a>
            <TrackPrediction label="Track" body={{ kind: "player_stat", playerId: p.player.id, statKey: p.statKey, gameId: p.gameId, threshold: p.line, side: p.side }} />
          </span>
        )}
      </div>
    </div>
  );
}
