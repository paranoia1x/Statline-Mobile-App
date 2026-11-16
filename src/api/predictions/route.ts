import { getStore } from "@/lib/store";
import { getProvider } from "@/lib/data";
import { forecastPlayerStat } from "@/lib/engine/service";
import { forecastGame } from "@/lib/engine/team";
import { CURRENT_MODEL_VERSION } from "@/lib/engine/model";
import type { Prediction } from "@/lib/store/types";
import { fail, handle, json, readJson, requireUser } from "@/lib/server/http";
import { NextResponse } from "next/server";

export async function GET() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  return json({ predictions: await getStore().listPredictions(u.id) });
}

interface Body {
  kind?: Prediction["kind"];
  playerId?: string;
  statKey?: string;
  gameId?: string;
  threshold?: number;
  side?: Prediction["side"];
  source?: Prediction["source"];
  note?: string;
}

/**
 * Track a forecast. The probability and projection are recomputed server-side
 * so stored predictions always reflect the model, not client input.
 */
export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const b = await readJson<Body>(req);
  if (!b?.gameId) return fail("gameId is required");
  try {
    const game = await getProvider().getGame(b.gameId);
    if (!game) return fail("Game not found", 404);
    if (game.status !== "scheduled" || Date.parse(game.date) <= getProvider().now().getTime())
      return fail("Only games that have not started can be tracked.");
    const base = { userId: u.id, source: b.source ?? "forecast", sport: game.sport, gameId: game.id, gameDate: game.date, modelVersion: CURRENT_MODEL_VERSION, status: "pending" as const, actual: null, gradedAt: null, note: b.note?.slice(0, 500) ?? null };
    const store = getStore();
    if ((b.kind ?? "player_stat") === "player_stat") {
      if (!b.playerId || !b.statKey || b.threshold == null) return fail("playerId, statKey and threshold are required");
      if (b.side !== "over" && b.side !== "under") return fail("side must be over or under");
      const { forecast, player } = await forecastPlayerStat({ playerId: b.playerId, statKey: b.statKey, gameId: game.id, threshold: Number(b.threshold) });
      const pred = await store.createPrediction({
        ...base, kind: "player_stat", playerId: player.id, teamId: player.teamId, opponentId: forecast.opponentId, statKey: forecast.statKey,
        threshold: forecast.threshold, side: b.side, projection: forecast.projection, probability: b.side === "over" ? forecast.pOver : forecast.pUnder,
        confidence: forecast.confidence.level,
      });
      return json({ prediction: pred }, 201);
    }
    const gf = await forecastGame(game);
    if (b.kind === "game_winner") {
      if (b.side !== "home" && b.side !== "away" && b.side !== "draw") return fail("side must be home, away or draw");
      const prob = b.side === "home" ? gf.pHomeWin : b.side === "away" ? gf.pAwayWin : gf.pDraw;
      const pred = await store.createPrediction({
        ...base, kind: "game_winner", playerId: null, teamId: b.side === "away" ? game.awayTeamId : game.homeTeamId, opponentId: b.side === "away" ? game.homeTeamId : game.awayTeamId,
        statKey: null, threshold: null, side: b.side, projection: gf.homeExpected - gf.awayExpected, probability: prob, confidence: gf.confidence,
      });
      return json({ prediction: pred }, 201);
    }
    if (b.kind === "game_total") {
      if (b.side !== "over" && b.side !== "under") return fail("side must be over or under");
      const pred = await store.createPrediction({
        ...base, kind: "game_total", playerId: null, teamId: game.homeTeamId, opponentId: game.awayTeamId, statKey: "total",
        threshold: gf.totalThreshold, side: b.side, projection: gf.projectedTotal, probability: b.side === "over" ? gf.pTotalOver : 1 - gf.pTotalOver, confidence: gf.confidence,
      });
      return json({ prediction: pred }, 201);
    }
    return fail("Unknown prediction kind");
  } catch (e) {
    return handle(e);
  }
}
