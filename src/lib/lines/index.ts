/**
 * Prop lines used as reference thresholds (PrizePicks by default): the lines the user
 * imported from their PrizePicks board (screenshot or paste), stored on the device.
 */
import { getProvider } from "@/lib/data";
import { parseScenarios } from "@/lib/parse/pick";
import { getStore } from "@/lib/store";
import { statDef } from "@/lib/sports";
import type { Game, SportId } from "@/lib/types";
import { nextGameForTeam } from "@/lib/engine/service";

export interface LineRef {
  source: "prizepicks" | "manual";
  origin: "imported" | "feed";
  sport: SportId;
  playerId: string;
  statKey: string;
  line: number;
  gameId: string | null;
  gameDate: string | null;
  updatedAt: string;
}

/** Active lines for a user (imported lines win over the feed), excluding games that have started. */
export async function activeLines(userId: string | null, sport?: SportId | null): Promise<LineRef[]> {
  const prov = getProvider();
  const now = prov.now().getTime();
  const fresh = (l: { gameDate: string | null; updatedAt: string }) =>
    l.gameDate ? Date.parse(l.gameDate) > now : now - Date.parse(l.updatedAt) < 36 * 3600_000;
  const imported: LineRef[] = userId
    ? (await getStore().listLines(userId))
        .map((l) => ({ source: l.source, origin: "imported" as const, sport: l.sport, playerId: l.playerId, statKey: l.statKey, line: l.line, gameId: l.gameId, gameDate: l.gameDate, updatedAt: l.createdAt }))
        .filter((l) => (!sport || l.sport === sport) && fresh(l))
    : [];
  return imported;
}

export function findLine(lines: LineRef[], playerId: string, statKey: string, gameId?: string | null) {
  return (
    lines.find((l) => l.playerId === playerId && l.statKey === statKey && (!gameId || !l.gameId || l.gameId === gameId)) ?? null
  );
}

export interface ImportResult {
  saved: { playerId: string; playerName: string; statKey: string; statLabel: string; line: number; gameId: string | null }[];
  skipped: { raw: string; reason: string }[];
}

/** Parse a pasted/OCR'd PrizePicks board and save its lines for the user. */
export async function importLinesFromText(userId: string, text: string): Promise<ImportResult> {
  const prov = getProvider();
  const [players, teams] = await Promise.all([prov.listPlayers(), prov.listTeams()]);
  const scenarios = parseScenarios(text, { players, teams }, prov.now());
  const result: ImportResult = { saved: [], skipped: [] };
  const toSave: Parameters<ReturnType<typeof getStore>["saveLines"]>[1] = [];
  for (const s of scenarios) {
    if (!s.playerId || !s.sport) continue;
    if (!s.statKey) {
      result.skipped.push({ raw: s.raw, reason: `${s.playerName}: statistic not recognised (combo/fantasy stats aren't modelled)` });
      continue;
    }
    if (s.threshold == null) {
      result.skipped.push({ raw: s.raw, reason: `${s.playerName}: no line found` });
      continue;
    }
    if (prov.unsupportedStats?.(s.sport).includes(s.statKey)) {
      result.skipped.push({ raw: s.raw, reason: `${s.playerName}: ${statDef(s.sport, s.statKey)?.label} isn't provided by the data source` });
      continue;
    }
    const player = players.find((p) => p.id === s.playerId)!;
    let game: Game | null = null;
    if (s.gameDate) {
      const day = Date.parse(s.gameDate + "T00:00:00Z");
      game = (await prov.listGames({ teamId: player.teamId, from: new Date(day - 12 * 3600_000).toISOString(), to: new Date(day + 36 * 3600_000).toISOString() }))[0] ?? null;
    }
    game ??= await nextGameForTeam(player.teamId);
    toSave.push({ source: "prizepicks", sport: s.sport, playerId: player.id, statKey: s.statKey, line: s.threshold, gameId: game?.id ?? null, gameDate: game?.date ?? null });
    result.saved.push({ playerId: player.id, playerName: player.name, statKey: s.statKey, statLabel: statDef(s.sport, s.statKey)?.label ?? s.statKey, line: s.threshold, gameId: game?.id ?? null });
  }
  if (toSave.length) await getStore().saveLines(userId, toSave);
  return result;
}

