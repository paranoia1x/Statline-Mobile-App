import { BASE } from "@/boot";
import { mergeNews, newsUrl, parseNews, type NewsItem } from "@/lib/news";
import { SPORT_IDS, type SportId } from "@/lib/types";

let fallback: Promise<NewsItem[]> | null = null;
const cache = new Map<string, { at: number; items: NewsItem[] }>();

/** Snapshot copy published by the data job (works offline). */
function snapshotNews() {
  return (fallback ??= fetch(`${BASE}data/news.json`)
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((d: { items: NewsItem[] }) => d.items ?? [])
    .catch(() => {
      fallback = null;
      return [] as NewsItem[];
    }));
}

/** Latest headlines: straight from ESPN when reachable, otherwise the last published copy. */
export async function loadNews(sport: SportId | null): Promise<{ items: NewsItem[]; live: boolean }> {
  const key = sport ?? "all";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return { items: hit.items, live: true };
  const sports = sport ? [sport] : SPORT_IDS;
  const lists = await Promise.all(
    sports.map((s) =>
      fetch(newsUrl(s))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((b) => parseNews(s, b))
        .catch(() => null),
    ),
  );
  if (lists.every((l) => l && l.length)) {
    const items = mergeNews(lists as NewsItem[][]);
    cache.set(key, { at: Date.now(), items });
    return { items, live: true };
  }
  const snap = (await snapshotNews()).filter((n) => !sport || n.sport === sport);
  // mix in whatever did load live
  return { items: mergeNews([...(lists.filter(Boolean) as NewsItem[][]), snap]), live: false };
}
