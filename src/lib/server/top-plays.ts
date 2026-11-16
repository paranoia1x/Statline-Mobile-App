/**
 * Top Plays: the model's highest-probability player-stat calls for a day.
 *
 * Nothing here is a guarantee. Plays are ranked by calibrated probability and
 * only "Likely" calls with at least medium confidence qualify. Each play's
 * line is the PrizePicks line when one is available, otherwise a "typical
 * line" (median of the player's previous 10 games, rounded to .5) — the same
 * rule the walk-forward backtest uses, so the published track record applies.
 * Past days are re-computed with data available before each game and graded
 * against final box scores, so results are shown honestly.
 */
import { getProvider } from "@/lib/data";
import { getTrackRecord } from "@/lib/engine/evaluation";
import { median } from "@/lib/engine/math";
import { forecastPlayerStat, primaryStats } from "@/lib/engine/service";
import { labelFor, strengthOf } from "@/lib/engine/verdict";
import { activeLines, findLine, type LineRef } from "@/lib/lines";
import { statDef } from "@/lib/sports";
import type { Game, SportId } from "@/lib/types";
import { SPORT_IDS } from "@/lib/types";
import { playerVM, teamVM, type PlayerVM, type TeamVM } from "@/lib/view";
import { injuryMap, teamMap } from "./lookups";

export interface Play {
  player: PlayerVM;
  opponent: TeamVM;
  home: boolean;
  gameId: string;
  gameDate: string;
  sport: SportId;
  statKey: string;
  statLabel: string;
  line: number;
  lineSource: "prizepicks" | "typical";
  side: "over" | "under";
  probability: number;
  projection: number;
  label: string;
  confidence: { level: "low" | "medium" | "high"; score: number };
  result: { status: "hit" | "miss" | "push" | "void" | "pending"; actual: number | null } | null;
}

export interface PlaysResult {
  plays: Play[];
  considered: number;
  trackRecord: Record<string, { n: number; rate: number | null }>;
}

const cache = new Map<string, { at: number; value: Promise<PlaysResult> }>();

/** Plays for games starting in [from, to). `graded` re-evaluates past games and attaches results. */
export function topPlays(opts: { from: Date; to: Date; sport: SportId | null; userId: string | null; limit?: number; graded?: boolean }): Promise<PlaysResult> {
  const key = `${opts.from.toISOString()}|${opts.to.toISOString()}|${opts.sport}|${opts.userId}|${opts.limit}|${opts.graded}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (opts.graded ? 30 : 10) * 60_000) return hit.value;
  const value = compute(opts);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  value.catch(() => cache.delete(key));
  return value;
}

async function compute({ from, to, sport, userId, limit = 12, graded = false }: Parameters<typeof topPlays>[0]): Promise<PlaysResult> {
  const prov = getProvider();
  const [teams, inj] = await Promise.all([teamMap(), injuryMap()]);
  const games = (await prov.listGames({ sport: sport ?? undefined, from: from.toISOString(), to: to.toISOString() })).filter((g) =>
    graded ? g.status === "final" : g.status === "scheduled" && Date.parse(g.date) > prov.now().getTime(),
  );
  const lines: LineRef[] = graded ? [] : await activeLines(userId, sport);

  // candidates: regular starters, healthy (for upcoming games), their top 2 modelled stats
  const perTeam = await Promise.all(
    games.flatMap((g) => [g.homeTeamId, g.awayTeamId].map(async (tid) => ({ g, tid, roster: await prov.listPlayers({ teamId: tid }) }))),
  );
  const candidates = perTeam.flatMap(({ g, tid, roster }) =>
    roster
      .filter((p) => p.role === "starter" && (graded || inj.get(p.id)?.status !== "out"))
      .flatMap((p) => {
        const unsupported = new Set(prov.unsupportedStats?.(p.sport) ?? []);
        const fromLines = lines.filter((l) => l.playerId === p.id && (!l.gameId || l.gameId === g.id)).map((l) => l.statKey);
        const stats = [...new Set([...fromLines, ...primaryStats(p).filter((s) => !unsupported.has(s.key)).slice(0, 2).map((s) => s.key)])];
        return stats.map((statKey) => ({ p, g, tid, statKey }));
      }),
  );

  const evaluated = await Promise.all(
    candidates.map(async ({ p, g, tid, statKey }): Promise<Play | null> => {
      try {
        const ref = findLine(lines, p.id, statKey, g.id);
        let line = ref?.line ?? null;
        if (line == null) {
          const prior = (await prov.getPlayerLogs(p.id, { before: g.date }))
            .map((l) => l.stats[statKey])
            .filter((v): v is number => typeof v === "number")
            .slice(-10);
          if (prior.length < 5) return null;
          line = Math.max(0.5, Math.floor(median(prior)) + 0.5);
          // skip non-competitive lines (e.g. "under 0.5 goals" for a player who rarely scores):
          // a real line is cleared somewhere between 20% and 80% of the time
          const overShare = prior.filter((v) => v > line!).length / prior.length;
          if (overShare < 0.2 || overShare > 0.8) return null;
        }
        const { forecast: f } = await forecastPlayerStat({ playerId: p.id, statKey, gameId: g.id, threshold: line });
        if (f.sample.games < 8) return null;
        const side = f.pOver >= f.pUnder ? "over" : "under";
        const prob = side === "over" ? f.pOver : f.pUnder;
        const decided = prob / Math.max(1e-9, f.pOver + f.pUnder);
        const opp = teams.get(f.opponentId)!;
        return {
          player: playerVM(p, teams.get(tid), inj.get(p.id)),
          opponent: teamVM(opp),
          home: f.home,
          gameId: g.id,
          gameDate: g.date,
          sport: p.sport,
          statKey,
          statLabel: statDef(p.sport, statKey)?.label ?? statKey,
          line,
          lineSource: ref ? "prizepicks" : "typical",
          side,
          probability: prob,
          projection: f.projection,
          label: labelFor(decided, f.confidence.level),
          confidence: f.confidence,
          result: null,
        };
      } catch {
        return null;
      }
    }),
  );

  const qualified = evaluated
    .filter((x): x is Play => !!x && x.confidence.level !== "low" && strengthOf(x.probability, x.confidence.level) === "likely")
    .sort((a, b) => b.probability - a.probability);
  // diversity: one play per player, at most 3 per game, and (across all sports) at most half from one sport
  const perGame = new Map<string, number>();
  const perSport = new Map<string, number>();
  const sportCap = sport ? limit : Math.ceil(limit / 2);
  const seen = new Set<string>();
  const plays: Play[] = [];
  for (const pl of qualified) {
    if (seen.has(pl.player.id) || (perGame.get(pl.gameId) ?? 0) >= 3 || (perSport.get(pl.sport) ?? 0) >= sportCap) continue;
    seen.add(pl.player.id);
    perGame.set(pl.gameId, (perGame.get(pl.gameId) ?? 0) + 1);
    perSport.set(pl.sport, (perSport.get(pl.sport) ?? 0) + 1);
    plays.push(pl);
    if (plays.length >= limit) break;
  }

  if (graded) await gradePlays(plays, games);

  const trackRecord: PlaysResult["trackRecord"] = {};
  for (const s of sport ? [sport] : SPORT_IDS) {
    const tr = await getTrackRecord(s);
    if (tr) trackRecord[s] = tr.likely;
  }
  return { plays, considered: evaluated.filter(Boolean).length, trackRecord };
}

async function gradePlays(plays: Play[], games: Game[]) {
  const prov = getProvider();
  const byGame = new Map<string, Awaited<ReturnType<typeof prov.getGamePlayerLogs>>>();
  for (const g of games) if (plays.some((p) => p.gameId === g.id)) byGame.set(g.id, await prov.getGamePlayerLogs(g.id));
  for (const p of plays) {
    const log = byGame.get(p.gameId)?.find((l) => l.playerId === p.player.id);
    const actual = log?.stats[p.statKey];
    if (typeof actual !== "number") {
      p.result = { status: "void", actual: null };
      continue;
    }
    const status = actual === p.line ? "push" : (actual > p.line) === (p.side === "over") ? "hit" : "miss";
    p.result = { status, actual };
  }
}
