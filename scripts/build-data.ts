/**
 * Data job: builds the stats snapshots the mobile app downloads.
 *
 *   npm run data            (writes public/data/*.json)
 *
 * 1. Syncs every sport from ESPN's public API with the same provider the desktop app uses
 *    (box scores are cached in data/espn-cache, so later runs only fetch new games).
 * 2. Writes one compact snapshot per sport plus meta.json.
 * 3. Loads those snapshots back through the app's SnapshotProvider and pre-computes the work
 *    that is too heavy for a phone: the walk-forward backtest (model calibration and track
 *    record) and Top Plays (upcoming + the last 7 days, graded).
 * Runs on a schedule in GitHub Actions (.github/workflows/deploy.yml).
 */
import fs from "node:fs";
import path from "node:path";
import { EspnProvider } from "../server/espn";
import { getImageProvider } from "../server/images";
import { getProvider, setProvider } from "@/lib/data";
import { SnapshotProvider } from "@/lib/data/snapshot";
import { packLogs, packTeamLogs, SNAPSHOT_VERSION, type SnapshotMeta, type SportSnapshot } from "@/lib/data/snapshot-format";
import { runBacktest, setPrecomputedBacktest, type BacktestResult } from "@/lib/engine/evaluation";
import { topPlays, type Play } from "@/lib/server/top-plays";
import { SPORTS } from "@/lib/sports";
import { SPORT_IDS, type PlayerGameLog, type SportId } from "@/lib/types";

const OUT = path.join(process.cwd(), "public", "data");
const SYNC_TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MIN || 40) * 60_000;
const DAY = 86_400_000;
const log = (...a: unknown[]) => console.log(`[data ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function waitForSync(espn: EspnProvider) {
  const start = Date.now();
  // touch every sport so base data loads and the box-score sync starts
  await Promise.all(SPORT_IDS.map((s) => espn.listTeams(s).catch((e) => log(`${s}: base load failed`, (e as Error).message))));
  for (;;) {
    const st = espn.syncStatus();
    const busy = st.filter((s) => s.running);
    if (st.length && !busy.length) return st;
    if (Date.now() - start > SYNC_TIMEOUT_MS) {
      log("sync timeout — publishing what has synced so far");
      return st;
    }
    log(st.map((s) => `${s.sport} ${s.done}/${s.total}${s.running ? "…" : ""}`).join("  "));
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

async function snapshotFor(espn: EspnProvider, sport: SportId): Promise<SportSnapshot> {
  const images = getImageProvider();
  const [teams, players, games, injuries, teamLogs] = await Promise.all([
    espn.listTeams(sport),
    espn.listPlayers({ sport }),
    espn.listGames({ sport }),
    espn.getInjuries(sport),
    espn.getTeamLogs({ sport }),
  ]);
  const logs: PlayerGameLog[] = (await Promise.all(players.map((p) => espn.getPlayerLogs(p.id)))).flat();
  const verified = (a: { url: string | null; verification: string }) => (a.url && a.verification === "verified" ? a.url : null);
  const img = { players: {} as Record<string, string>, teams: {} as Record<string, string> };
  for (const p of players) {
    const u = verified(images.getPlayerImage(p));
    if (u) img.players[p.id] = u;
  }
  for (const t of teams) {
    const u = verified(images.getTeamLogo(t));
    if (u) img.teams[t.id] = u;
  }
  const def = SPORTS[sport];
  return {
    v: SNAPSHOT_VERSION,
    sport,
    generatedAt: new Date().toISOString(),
    source: "ESPN public API",
    labels: { playingTimeLabel: def.playingTimeLabel, playingTimeShort: def.playingTimeShort, usageLabel: def.usageLabel ?? undefined },
    unsupported: espn.unsupportedStats(sport),
    teams,
    // keep players who are on a roster; drop fields the app never reads
    players,
    games,
    injuries,
    ...packLogs(players, games, logs),
    ...packTeamLogs(teams, games, teamLogs),
    images: img,
  };
}

const slimPlay = (p: Play) => p; // plays are already view models

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const espn = new EspnProvider();
  setProvider(espn);
  log("syncing ESPN data…");
  const status = await waitForSync(espn);
  log("synced:", status.map((s) => `${s.sport} ${s.done}/${s.total}${s.failed ? ` (${s.failed} failed)` : ""}`).join("  "));

  const meta: SnapshotMeta = { v: SNAPSHOT_VERSION, generatedAt: new Date().toISOString(), sports: [], files: { model: "model.json", plays: "plays.json" } };
  const snaps: SportSnapshot[] = [];
  for (const sport of SPORT_IDS) {
    try {
      const snap = await snapshotFor(espn, sport);
      const body = JSON.stringify(snap);
      const file = `${sport}.json`;
      fs.writeFileSync(path.join(OUT, file), body);
      snaps.push(snap);
      meta.sports.push({ sport, file, bytes: body.length, games: snap.games.length, finals: snap.games.filter((g) => g.status === "final").length, players: snap.players.length });
      log(`${sport}: ${(body.length / 1e6).toFixed(2)} MB · ${snap.teams.length} teams · ${snap.players.length} players · ${snap.logs.length} player-games`);
    } catch (e) {
      log(`${sport}: snapshot failed`, (e as Error).message);
    }
  }

  // ---- heavy computations, run against the snapshots exactly as the app will read them
  const snapProv = new SnapshotProvider("");
  for (const s of snaps) snapProv.attach(s);
  setProvider(snapProv);

  const model: Omit<BacktestResult, "samples">[] = [];
  for (const s of snaps) {
    const t0 = Date.now();
    const bt = await runBacktest(s.sport);
    const { samples, ...rest } = bt;
    model.push(rest);
    log(`${s.sport}: backtest ${bt.metrics.n} samples, accuracy ${((bt.metrics.accuracy ?? 0) * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    void samples;
  }
  fs.writeFileSync(path.join(OUT, "model.json"), JSON.stringify({ generatedAt: new Date().toISOString(), backtests: model }));
  setPrecomputedBacktest(model.map((m) => ({ ...m, samples: [] })));

  const now = getProvider().now();
  const todayStart = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const plays: Record<string, { upcoming: Play[]; considered: number; recent: { day: string; plays: Play[] }[] }> = {};
  const trackRecord: Record<string, { n: number; rate: number | null }> = {};
  for (const s of snaps) {
    const t0 = Date.now();
    const up = await topPlays({ from: now, to: new Date(now.getTime() + 36 * 3600_000), sport: s.sport, userId: null, limit: 12 });
    const recent: { day: string; plays: Play[] }[] = [];
    for (let d = 1; d <= 7; d++) {
      const r = await topPlays({ from: new Date(todayStart - d * DAY), to: new Date(todayStart - (d - 1) * DAY), sport: s.sport, userId: null, limit: 12, graded: true });
      recent.push({ day: new Date(todayStart - d * DAY).toISOString(), plays: r.plays.map(slimPlay) });
    }
    plays[s.sport] = { upcoming: up.plays.map(slimPlay), considered: up.considered, recent };
    Object.assign(trackRecord, up.trackRecord);
    log(`${s.sport}: ${up.plays.length} plays from ${up.considered} calls (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync(path.join(OUT, "plays.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sports: plays, trackRecord }));
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
  log("done →", OUT);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
