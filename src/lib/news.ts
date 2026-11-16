/**
 * Sports news from ESPN's public news feed (shared by the desktop and mobile apps).
 * Only plain text is kept (nothing is rendered as HTML) and links must point to ESPN.
 */
import type { SportId } from "@/lib/types";

export interface NewsItem {
  id: string;
  sport: SportId;
  type: string; // Story, Recap, HeadlineNews, Media…
  headline: string;
  description: string;
  published: string; // ISO
  imageUrl: string | null;
  url: string | null; // full story on espn.com
  teamIds: string[]; // app ids, e.g. "nba-t25"
  playerIds: string[]; // app ids, e.g. "nba-p3934672"
  premium: boolean;
}

export const NEWS_PATHS: Record<SportId, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  soccer: "soccer/eng.1",
};

export const newsUrl = (sport: SportId, limit = 25) => `https://site.api.espn.com/apis/site/v2/sports/${NEWS_PATHS[sport]}/news?limit=${limit}`;

const ESPN_LINK = /^https?:\/\/([a-z0-9-]+\.)*(espn\.com|espn\.go\.com|espncricinfo\.com)\//i;
const ESPN_IMAGE = /^https:\/\/(a|s)\.espncdn\.com\//i;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseNews(sport: SportId, body: any): NewsItem[] {
  const out: NewsItem[] = [];
  for (const a of body?.articles ?? []) {
    const headline = text(a?.headline, 220);
    if (!headline) continue;
    const imgs: any[] = Array.isArray(a.images) ? a.images : [];
    // real photos first; ESPN's "stitcher" matchup graphics as a fallback
    const img = imgs.find((i) => i?.type !== "stitcher" && ESPN_IMAGE.test(String(i?.url))) ?? imgs.find((i) => ESPN_IMAGE.test(String(i?.url)));
    let url: string | null = a?.links?.web?.href ?? a?.links?.mobile?.href ?? null;
    if (url && ESPN_LINK.test(url)) url = url.replace(/^http:/i, "https:");
    else url = null;
    const cats: any[] = Array.isArray(a.categories) ? a.categories : [];
    out.push({
      id: `${sport}-n${a.id ?? out.length}`,
      sport,
      type: text(a.type, 40) || "Story",
      headline,
      description: text(a.description, 400),
      published: a.published && !Number.isNaN(Date.parse(a.published)) ? new Date(a.published).toISOString() : new Date().toISOString(),
      imageUrl: img ? String(img.url) : null,
      url,
      teamIds: [...new Set(cats.filter((c) => c?.type === "team" && (c.teamId ?? c.team?.id)).map((c) => `${sport}-t${c.teamId ?? c.team.id}`))],
      playerIds: [...new Set(cats.filter((c) => c?.type === "athlete" && (c.athleteId ?? c.athlete?.id)).map((c) => `${sport}-p${c.athleteId ?? c.athlete.id}`))],
      premium: !!a.premium,
    });
  }
  return out;
}

/** Newest first, de-duplicated across sports. */
export function mergeNews(lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((n) => (seen.has(n.headline) ? false : (seen.add(n.headline), true)))
    .sort((a, b) => b.published.localeCompare(a.published));
}
