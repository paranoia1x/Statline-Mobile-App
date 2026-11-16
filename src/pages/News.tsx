import { useState } from "react";
import { provider } from "@/boot";
import { useData, useSport } from "@/hooks";
import { loadNews } from "@/lib/news-client";
import { injuryUpdates } from "@/lib/server/injury-updates";
import { injuryMap, teamMap } from "@/lib/server/lookups";
import { playerVM, teamVM, type PlayerVM, type TeamVM } from "@/lib/view";
import { InjuryUpdates, NewsCard } from "@/components/news";
import { Loading, Segmented } from "@/components/mobile";
import { EmptyState } from "@/components/ui";

const PAGE = 15;

export default function News() {
  const [sport] = useSport();
  const [tab, setTab] = useState<"headlines" | "injuries">("headlines");
  const [limit, setLimit] = useState(PAGE);
  const news = useData(async () => {
    const [{ items, live }, teams, inj] = await Promise.all([loadNews(sport), teamMap(sport), injuryMap(sport)]);
    const teamVMs: Record<string, TeamVM> = {};
    const playerVMs: Record<string, PlayerVM> = {};
    for (const n of items.slice(0, 60)) {
      for (const id of n.teamIds) if (teams.has(id)) teamVMs[id] = teamVM(teams.get(id)!);
      for (const id of n.playerIds) {
        if (playerVMs[id]) continue;
        const p = await provider.getPlayer(id);
        if (p) playerVMs[id] = playerVM(p, teams.get(p.teamId), inj.get(p.id));
      }
    }
    return { items, live, teamVMs, playerVMs };
  }, [sport]);
  const updates = useData(() => injuryUpdates(sport, 30), [sport]);

  return (
    <div className="space-y-4">
      <Segmented value={tab} onChange={setTab} options={[{ id: "headlines", label: "Headlines" }, { id: "injuries", label: "Injuries" }]} />
      {tab === "headlines" ? (
        !news.data ? (
          <Loading rows={4} />
        ) : news.data.items.length ? (
          <div className="space-y-3">
            {!news.data.live && <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">Showing the last saved headlines — ESPN couldn't be reached.</div>}
            {news.data.items.slice(0, limit).map((n) => (
              <NewsCard key={n.id} item={n} imageSrc={n.imageUrl} teams={news.data!.teamVMs} players={news.data!.playerVMs} showSport={!sport} compact />
            ))}
            {news.data.items.length > limit && (
              <button className="btn w-full" onClick={() => setLimit((l) => l + PAGE)}>Show more headlines</button>
            )}
          </div>
        ) : (
          <EmptyState title="No news right now" body="Check your connection and try again." />
        )
      ) : !updates.data ? (
        <Loading rows={4} />
      ) : (
        <div className="card card-pad">
          <InjuryUpdates rows={updates.data} />
        </div>
      )}
      <p className="px-1 text-[11px] text-ink-500">Headlines, summaries and images © ESPN — tap a story to read it on ESPN.</p>
    </div>
  );
}
