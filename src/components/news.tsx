import Link from "next/link";
import type { NewsItem } from "@/lib/news";
import type { PlayerVM, TeamVM } from "@/lib/view";
import { cx } from "@/lib/format";
import { PlayerAvatar, TeamLogo } from "./media";
import { AvailabilityBadge, SportTag } from "./ui";
import { NewsImage } from "./NewsImage";

export function timeAgo(iso: string, now = Date.now()) {
  const m = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A headline card: photo, headline (opens the full story on ESPN), summary and tags. */
export function NewsCard({
  item,
  imageSrc,
  teams,
  players,
  showSport,
  compact = false,
}: {
  item: NewsItem;
  imageSrc: string | null;
  teams: Record<string, TeamVM>;
  players: Record<string, PlayerVM>;
  showSport?: boolean;
  compact?: boolean;
}) {
  const ps = item.playerIds.map((id) => players[id]).filter(Boolean).slice(0, 3);
  // stories tagged with many teams (league round-ups) don't need a logo strip
  const ts = item.teamIds.length <= 4 ? item.teamIds.map((id) => teams[id]).filter(Boolean) : [];
  const Head = item.url ? "a" : "div";
  return (
    <article className={cx("card overflow-hidden", !compact && "sm:flex")}>
      {imageSrc && <NewsImage src={imageSrc} className={cx("w-full bg-ink-850 object-cover", compact ? "aspect-[16/9]" : "aspect-[16/9] sm:aspect-auto sm:w-64 sm:shrink-0")} />}
      <div className="min-w-0 flex-1 p-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
          {showSport && <SportTag sport={item.sport} />}
          <span className="font-medium uppercase tracking-wider text-brand-light">{item.type === "HeadlineNews" ? "News" : item.type}</span>
          <span>·</span>
          <time dateTime={item.published}>{timeAgo(item.published)}</time>
          {item.premium && <span className="rounded bg-warn/15 px-1 text-warn">ESPN+</span>}
        </div>
        <Head {...(item.url ? { href: item.url, target: "_blank", rel: "noopener noreferrer" } : {})} className="block text-[15px] font-semibold leading-snug text-white hover:underline">
          {item.headline}
        </Head>
        {item.description && !compact && <p className="mt-1.5 line-clamp-3 text-sm text-ink-300">{item.description}</p>}
        {(ps.length > 0 || ts.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ps.map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} className="chip gap-1.5 py-0.5 pl-0.5">
                <PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="xs" />
                {p.name}
              </Link>
            ))}
            {ts.map((t) => (
              <Link key={t.id} href={`/teams/${t.id}`} className="chip gap-1.5 py-0.5 pl-0.5">
                <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="xs" />
                {t.abbreviation}
              </Link>
            ))}
          </div>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-medium text-brand-light hover:text-white">
            Read on ESPN ↗
          </a>
        )}
      </div>
    </article>
  );
}

/** Latest injury-report notes (who's out, for how long). */
export function InjuryUpdates({ rows }: { rows: { player: PlayerVM; status: Parameters<typeof AvailabilityBadge>[0]["status"]; seasonEnding: boolean; returns: string | null; note: string; updatedAt: string }[] }) {
  if (!rows.length) return <div className="text-sm text-ink-400">No recent injury updates.</div>;
  return (
    <ul className="divide-y divide-ink-800">
      {rows.map((r) => (
        <li key={r.player.id} className="py-3 first:pt-0">
          <div className="flex items-center gap-2.5">
            <PlayerAvatar name={r.player.name} imageUrl={r.player.imageUrl} size="sm" ringColor={r.player.team?.colors.primary} />
            <div className="min-w-0 flex-1">
              <Link href={`/players/${r.player.id}`} className="block truncate text-sm font-medium text-ink-100 hover:text-white">{r.player.name}</Link>
              <div className="text-[11px] text-ink-400">{r.player.team?.abbreviation} · {r.player.position} · {timeAgo(r.updatedAt)}</div>
            </div>
            <AvailabilityBadge status={r.status} seasonEnding={r.seasonEnding} returns={r.returns} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{r.note}</p>
        </li>
      ))}
    </ul>
  );
}
