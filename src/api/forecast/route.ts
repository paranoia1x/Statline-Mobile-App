import { forecastPlayerStat } from "@/lib/engine/service";
import { narrate } from "@/lib/ai/narrate";
import { forecastTemplate } from "@/lib/ai/templates";
import { getProvider } from "@/lib/data";
import { playerVM, teamVM } from "@/lib/view";
import { teamMap, gameVM } from "@/lib/server/lookups";
import { fail, handle, json, readJson } from "@/lib/server/http";
import { verdictFor } from "@/lib/server/verdict";
import { getCurrentUser } from "@/lib/auth";
import { activeLines, findLine } from "@/lib/lines";

/** POST { playerId, statKey, gameId?, threshold? } -> statistical forecast + explanation. */
export async function POST(req: Request) {
  const body = await readJson<{ playerId?: string; statKey?: string; gameId?: string; threshold?: number | string | null; side?: "over" | "under" | null }>(req);
  if (!body?.playerId || !body.statKey) return fail("playerId and statKey are required");
  let threshold = body.threshold === "" || body.threshold == null ? null : Number(body.threshold);
  if (threshold != null && (!Number.isFinite(threshold) || threshold < 0)) return fail("Threshold must be a non-negative number");
  try {
    // With no threshold given, use the PrizePicks line for this player/stat when one is available.
    const user = await getCurrentUser();
    const pl = await getProvider().getPlayer(body.playerId);
    const lines = pl ? (await activeLines(user?.id ?? null, pl.sport)).filter((l) => l.playerId === body.playerId) : [];
    const ref = findLine(lines, body.playerId, body.statKey, body.gameId || null);
    if (threshold == null && ref) threshold = ref.line;
    const { forecast, player, game } = await forecastPlayerStat({ playerId: body.playerId, statKey: body.statKey, gameId: body.gameId || null, threshold });
    const lineUsed = ref && forecast.threshold === ref.line ? ref : null;
    const p = getProvider();
    const teams = await teamMap(player.sport);
    const opp = teams.get(forecast.opponentId)!;
    const injury = await p.getInjury(player.id);
    const narrative = await narrate(
      "player forecast",
      {
        player: player.name,
        opponent: opp.fullName,
        statistic: forecast.statLabel,
        projection: +forecast.projection.toFixed(2),
        threshold: forecast.threshold,
        probabilityAbove: +forecast.pOver.toFixed(3),
        probabilityBelow: +forecast.pUnder.toFixed(3),
        confidence: forecast.confidence,
        components: forecast.components.map((c) => `${c.label}: ${c.value}`),
        supportingEvidence: forecast.supporting.map((e) => e.text),
        conflictingEvidence: forecast.conflicting.map((e) => e.text),
        context: forecast.context,
        warnings: forecast.warnings,
        sample: forecast.sample,
        dataIsDemo: p.isDemo,
      },
      forecastTemplate(forecast, player.name, opp.fullName, p.isDemo),
    );
    const side = body.side === "over" || body.side === "under" ? body.side : null;
    const v = await verdictFor(forecast, player.sport, player.name, opp.fullName, side, p.isDemo);
    return json({
      forecast,
      narrative,
      verdict: v.verdict,
      verdictNarrative: v.narrative,
      trackRecord: v.trackRecord,
      player: playerVM(player, teams.get(player.teamId), injury),
      opponent: teamVM(opp),
      game: game ? gameVM(game, teams) : null,
      line: lineUsed,
      playerLines: lines.filter((l) => !l.gameId || !game || l.gameId === game.id),
      teamAbbr: Object.fromEntries([...teams.values()].map((t) => [t.id, t.abbreviation])),
    });
  } catch (e) {
    return handle(e);
  }
}
