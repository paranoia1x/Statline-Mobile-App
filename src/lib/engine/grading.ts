import { getProvider } from "@/lib/data";
import type { Prediction, PredictionStatus } from "@/lib/store/types";

/**
 * Grades a stored prediction against FINAL game statistics from the data
 * provider. Games that are not final stay pending; a player who did not
 * appear in the final box score is graded "void" (not hidden).
 */
export async function gradePrediction(pred: Prediction): Promise<{ status: PredictionStatus; actual: number | null } | null> {
  const p = getProvider();
  const game = await p.getGame(pred.gameId);
  if (!game) return { status: "void", actual: null };
  if (game.status !== "final" || game.homeScore == null || game.awayScore == null) return null;

  if (pred.kind === "player_stat") {
    const logs = await p.getGamePlayerLogs(game.id);
    const log = logs.find((l) => l.playerId === pred.playerId);
    if (!log || typeof log.stats[pred.statKey!] !== "number") return { status: "void", actual: null };
    const actual = log.stats[pred.statKey!];
    return { status: compare(actual, pred.threshold!, pred.side), actual };
  }
  if (pred.kind === "game_total") {
    const actual = game.homeScore + game.awayScore;
    return { status: compare(actual, pred.threshold!, pred.side), actual };
  }
  // game_winner
  const winner = game.homeScore > game.awayScore ? "home" : game.homeScore < game.awayScore ? "away" : "draw";
  return { status: winner === pred.side ? "correct" : "incorrect", actual: game.homeScore - game.awayScore };
}

function compare(actual: number, threshold: number, side: Prediction["side"]): PredictionStatus {
  if (actual === threshold) return "push";
  const over = actual > threshold;
  return (side === "over") === over ? "correct" : "incorrect";
}
