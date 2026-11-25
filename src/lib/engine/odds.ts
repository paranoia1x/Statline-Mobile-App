/**
 * Betting-market helpers. A game's spread and total imply how many points each team is
 * expected to score ("implied team total"), which is the single best summary of a game's
 * scoring environment: it already prices in both offenses and defenses, pace, injuries and
 * weather. Used by the fantasy projections and the player-stat forecasts.
 */
import type { Game, SportId } from "@/lib/types";
import { poissonPmf } from "./math";

/** Moneyline (American odds) to implied probability (with the bookmaker margin still in). */
export function mlToProb(ml: number | null | undefined): number | null {
  if (ml == null || !Number.isFinite(ml) || ml === 0) return null;
  return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
}

/**
 * Expected score for each side implied by the market, or null when the game has no usable line.
 * Spread sports (NBA, NFL): home = (total − spread) / 2. Low-scoring sports (NHL, MLB, soccer)
 * split the total so a Poisson model reproduces the no-vig moneyline.
 */
export function impliedScores(game: Pick<Game, "odds">, sport: SportId): { home: number; away: number } | null {
  const o = game.odds;
  if (!o || o.total == null || !(o.total > 0)) return null;
  if ((sport === "nba" || sport === "nfl") && o.spread != null && Math.abs(o.spread) < o.total) {
    return { home: (o.total - o.spread) / 2, away: (o.total + o.spread) / 2 };
  }
  const ph = mlToProb(o.homeMl);
  const pa = mlToProb(o.awayMl);
  if (ph == null || pa == null) return { home: o.total / 2, away: o.total / 2 };
  const key = `${o.total}|${o.homeMl}|${o.awayMl}`;
  const hit = splitCache.get(key);
  if (hit) return { home: o.total * hit, away: o.total * (1 - hit) };
  const target = ph / (ph + pa); // P(home wins | not a draw)
  let lo = 0.2;
  let hi = 0.8;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (winShare(o.total * mid, o.total * (1 - mid)) < target) lo = mid;
    else hi = mid;
  }
  const share = (lo + hi) / 2;
  splitCache.set(key, share);
  if (splitCache.size > 5000) splitCache.delete(splitCache.keys().next().value!);
  return { home: o.total * share, away: o.total * (1 - share) };
}
const splitCache = new Map<string, number>();

function winShare(h: number, a: number) {
  let ph = 0;
  let pa = 0;
  const H = Array.from({ length: 21 }, (_, i) => poissonPmf(i, h));
  const A = Array.from({ length: 21 }, (_, i) => poissonPmf(i, a));
  for (let i = 0; i <= 20; i++)
    for (let j = 0; j <= 20; j++) {
      const p = H[i] * A[j];
      if (i > j) ph += p;
      else if (j > i) pa += p;
    }
  return ph / Math.max(1e-9, ph + pa);
}

/** Implied score for one team in a game. */
export function impliedTeamTotal(game: Game, teamId: string): number | null {
  const s = impliedScores(game, game.sport);
  if (!s) return null;
  return teamId === game.homeTeamId ? s.home : teamId === game.awayTeamId ? s.away : null;
}

/** Team's implied total for a game and its usual scoring (recent window from the league context). */
export function gameEnvFor(game: Game, teamId: string, usual: number | null | undefined): { expected: number; usual: number } | null {
  const expected = impliedTeamTotal(game, teamId);
  return expected != null && usual != null && usual > 0 ? { expected, usual } : null;
}

/** Days between a team's previous game and this one, from a sorted list of its game dates. */
export function restFromDates(dates: string[], date: string): number | null {
  let prev: string | null = null;
  for (const d of dates) {
    if (d >= date) break;
    prev = d;
  }
  return prev ? (Date.parse(date) - Date.parse(prev)) / 86_400_000 : null;
}
