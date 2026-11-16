import Link from "next/link";
import { PlayerAvatar, TeamLogo } from "./media";
import { SportTag } from "./ui";
import type { GameVM, PlayerVM, TeamVM } from "@/lib/view";
import { fmtDate, fmtTime, cx } from "@/lib/format";

export function TeamInline({ team, size = "sm", href = true, full = false }: { team: TeamVM; size?: "xs" | "sm" | "md"; href?: boolean; full?: boolean }) {
  const inner = (
    <span className={cx("inline-flex items-center gap-2", full ? "min-w-0" : "shrink-0")}>
      <TeamLogo abbreviation={team.abbreviation} name={team.fullName} logoUrl={team.logoUrl} colors={team.colors} size={size} />
      <span className={full ? "truncate" : "whitespace-nowrap"}>{full ? team.fullName : team.abbreviation}</span>
    </span>
  );
  return href ? (
    <Link href={`/teams/${team.id}`} className={cx(full ? "min-w-0" : "shrink-0", "hover:text-white")}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function PlayerInline({ player, size = "sm", sub }: { player: PlayerVM; size?: "xs" | "sm" | "md" | "lg"; sub?: React.ReactNode }) {
  return (
    <Link href={`/players/${player.id}`} className="group flex min-w-0 items-center gap-3">
      <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size={size} ringColor={player.team?.colors.primary} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink-100 group-hover:text-white">{player.name}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-ink-400">
          {player.team && (
            <TeamLogo abbreviation={player.team.abbreviation} name={player.team.fullName} logoUrl={player.team.logoUrl} colors={player.team.colors} size="xs" />
          )}
          {player.position} · #{player.jersey}
          {sub}
        </span>
      </span>
    </Link>
  );
}

/** Schedule card with both logos and (optionally) the key players for each side. */
export function GameCard({ game, keyPlayers, showSport }: { game: GameVM; keyPlayers?: { home: PlayerVM[]; away: PlayerVM[] }; showSport?: boolean }) {
  const final = game.status === "final";
  const side = (t: TeamVM, score: number | null, won: boolean, players?: PlayerVM[]) => (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="md" />
        <div className="min-w-0">
          <div className={cx("truncate text-sm font-medium", final && !won ? "text-ink-400" : "text-ink-100")}>{t.fullName}</div>
          {players && players.length > 0 && (
            <div className="mt-1 flex -space-x-1.5">
              {players.slice(0, 3).map((p) => (
                <PlayerAvatar key={p.id} name={p.name} imageUrl={p.imageUrl} size="xs" ringColor="rgb(var(--ink-900))" />
              ))}
              <span className="pl-3 text-[11px] text-ink-400">{players.slice(0, 2).map((p) => p.lastName).join(", ")}</span>
            </div>
          )}
        </div>
      </div>
      {final && <span className={cx("num text-lg font-semibold", won ? "text-white" : "text-ink-400")}>{score}</span>}
    </div>
  );
  const homeWon = final && (game.homeScore ?? 0) > (game.awayScore ?? 0);
  const awayWon = final && (game.awayScore ?? 0) > (game.homeScore ?? 0);
  return (
    <Link href={`/matchups/${game.id}`} className="card block p-4 transition-colors hover:border-ink-500">
      <div className="mb-3 flex items-center justify-between text-[11px] text-ink-400">
        <span className="flex items-center gap-2">
          {showSport && <SportTag sport={game.sport} />}
          {fmtDate(game.date, { weekday: "short", month: "short", day: "numeric" })} · {final ? "Final" : fmtTime(game.date)}
        </span>
        <span className="truncate pl-2">{game.venue}</span>
      </div>
      <div className="space-y-3">
        {side(game.away, game.awayScore, awayWon, keyPlayers?.away)}
        {side(game.home, game.homeScore, homeWon, keyPlayers?.home)}
      </div>
    </Link>
  );
}
