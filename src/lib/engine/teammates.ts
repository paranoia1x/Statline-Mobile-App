/**
 * Teammate absences. When regular contributors are out, their share of the team's production
 * (shots, touches, minutes) goes to the players who remain, so their projections rise.
 *
 * "Regulars" are teammates who played in at least 3 of the team's last 5 games, so players who
 * have been out for weeks (already reflected in everyone's recent form) are not counted again.
 *  - upcoming games: absences come from the injury report (out = 1, doubtful = 0.7)
 *  - completed games (backtest): absences are regulars missing from that game's box score
 */
import { getProvider } from "@/lib/data";
import type { Game, Player } from "@/lib/types";
import { MODEL_PARAMS } from "./player-forecast";

export interface TeammatesOut {
  /** Share of the team's typical production in this stat that is missing (0–0.6). */
  share: number;
  players: { id: string; name: string; share: number }[];
}

const RECENT_GAMES = 5;
const MIN_APPEARANCES = 3;
const MIN_SHARE = 0.04;
const cache = new Map<string, Promise<TeammatesOut | null>>();

export function teammatesOut(player: Player, statKey: string, game: Game): Promise<TeammatesOut | null> {
  const mode = game.status === "final" ? "box" : "injuries";
  const key = `${player.teamId}|${game.id}|${statKey}|${mode}`;
  let p = cache.get(key);
  if (!p) {
    p = compute(player.teamId, statKey, game, mode);
    cache.set(key, p);
    if (cache.size > 20_000) cache.delete(cache.keys().next().value!);
    p.catch(() => cache.delete(key));
  }
  // the player's own absence never boosts himself; only significant contributors count
  return p.then((t) => {
    if (!t) return null;
    const players = t.players.filter((x) => x.id !== player.id && x.share >= MODEL_PARAMS.teammateMinShare);
    const share = Math.min(0.6, players.reduce((a, x) => a + x.share, 0));
    return share > 0 ? { share, players } : null;
  });
}

async function compute(teamId: string, statKey: string, game: Game, mode: "box" | "injuries"): Promise<TeammatesOut | null> {
  const prov = getProvider();
  const recent = (await prov.listGames({ teamId, to: game.date, status: "final" })).filter((g) => g.date < game.date).slice(-RECENT_GAMES);
  if (recent.length < MIN_APPEARANCES) return null;
  const boxes = await Promise.all(recent.map((g) => prov.getGamePlayerLogs(g.id)));
  // team total and each player's production in this stat over the recent games
  let teamTotal = 0;
  const per = new Map<string, { sum: number; games: number }>();
  for (const logs of boxes)
    for (const l of logs) {
      if (l.teamId !== teamId) continue;
      const v = l.stats[statKey];
      if (typeof v !== "number") continue;
      teamTotal += v;
      const e = per.get(l.playerId) ?? { sum: 0, games: 0 };
      e.sum += v;
      e.games++;
      per.set(l.playerId, e);
    }
  if (teamTotal <= 0) return null;
  const teamPerGame = teamTotal / recent.length;

  let absentWeight: (id: string) => number;
  if (mode === "box") {
    const played = new Set((await prov.getGamePlayerLogs(game.id)).filter((l) => l.teamId === teamId).map((l) => l.playerId));
    if (!played.size) return null; // no box score for this game
    absentWeight = (id) => (played.has(id) ? 0 : 1);
  } else {
    const injuries = await prov.getInjuries(game.sport);
    const status = new Map(injuries.map((i) => [i.playerId, i.status]));
    absentWeight = (id) => (status.get(id) === "out" ? 1 : status.get(id) === "doubtful" ? 0.7 : 0);
  }

  const out: TeammatesOut["players"] = [];
  for (const [id, e] of per) {
    if (e.games < MIN_APPEARANCES) continue;
    const w = absentWeight(id);
    if (!w) continue;
    const share = (e.sum / e.games / teamPerGame) * w;
    if (share < MIN_SHARE) continue;
    const pl = await prov.getPlayer(id);
    out.push({ id, name: pl?.name ?? "A teammate", share });
  }
  if (!out.length) return null;
  out.sort((a, b) => b.share - a.share);
  return { share: Math.min(0.6, out.reduce((a, x) => a + x.share, 0)), players: out };
}
