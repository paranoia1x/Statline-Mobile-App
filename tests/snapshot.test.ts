import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DEMO_NOW = "2026-11-14T12:00:00Z";
import { setProvider, visibleStats } from "../src/lib/data";
import { SnapshotProvider } from "../src/lib/data/snapshot";
import { packLogs, packTeamLogs, SNAPSHOT_VERSION, type SportSnapshot } from "../src/lib/data/snapshot-format";
import { forecastPlayerStat } from "../src/lib/engine/service";
import { forecastGame } from "../src/lib/engine/team";
import { aggregateStat } from "../src/lib/sports";
import { SPORT_IDS, type SportId } from "../src/lib/types";
import { DemoProvider } from "./fixtures/demo";

const demo = new DemoProvider();

/** Packs a sport from the demo provider exactly like the data job does. */
async function snapshotOf(sport: SportId): Promise<SportSnapshot> {
  const [teams, players, games, injuries, teamLogs] = await Promise.all([
    demo.listTeams(sport), demo.listPlayers({ sport }), demo.listGames({ sport }), demo.getInjuries(sport), demo.getTeamLogs({ sport }),
  ]);
  const logs = (await Promise.all(players.map((p) => demo.getPlayerLogs(p.id)))).flat();
  // through JSON, as the phone receives it
  return JSON.parse(
    JSON.stringify({
      v: SNAPSHOT_VERSION, sport, generatedAt: new Date().toISOString(), source: "test", labels: {}, unsupported: [],
      teams, players, games, injuries, ...packLogs(players, games, logs), ...packTeamLogs(teams, games, teamLogs), images: { players: {}, teams: {} },
    }),
  );
}

const snap = new SnapshotProvider("");
snap.fixedNow = demo.now(); // same clock as the source data
const ready = Promise.all(SPORT_IDS.map(async (s) => snap.attach(await snapshotOf(s))));

test("snapshot round-trip keeps every player and team game log", async () => {
  await ready;
  for (const sport of SPORT_IDS) {
    const players = await demo.listPlayers({ sport });
    for (const p of players.slice(0, 40)) {
      const a = await demo.getPlayerLogs(p.id);
      const b = await snap.getPlayerLogs(p.id);
      assert.equal(b.length, a.length, `${p.id} log count`);
      for (let i = 0; i < a.length; i++) {
        assert.equal(b[i].gameId, a[i].gameId);
        assert.equal(b[i].home, a[i].home);
        assert.equal(b[i].opponentId, a[i].opponentId);
        for (const [k, v] of Object.entries(a[i].stats)) assert.ok(Math.abs(b[i].stats[k] - v) < 0.006, `${p.id} ${k}`);
      }
    }
    const ta = await demo.getTeamLogs({ sport });
    const tb = await snap.getTeamLogs({ sport });
    assert.equal(tb.length, ta.length, `${sport} team logs`);
  }
});

test("QB and RB rushing TD averages include games with no carries", async () => {
  const nfl = await snapshotOf("nfl");
  const rushTd = 5 + nfl.statKeys.indexOf("rushTd");
  const carries = 5 + nfl.statKeys.indexOf("carries");
  const positions = ["QB", "RB"];

  for (const position of positions) {
    const playerIndex = nfl.players.findIndex((player) => player.positionGroup === position);
    const logs = nfl.logs.filter(([index]) => index === playerIndex).slice(0, 3);
    assert.equal(logs.length, 3);
    logs[0]![rushTd] = 2;
    logs[0]![carries] = 5;
    logs[1]![rushTd] = null;
    logs[1]![carries] = null;
    logs[2]![rushTd] = null;
    logs[2]![carries] = 3;
  }

  const provider = new SnapshotProvider("");
  provider.attach(nfl);
  setProvider(provider);
  try {
    for (const position of positions) {
      const player = nfl.players.find((player) => player.positionGroup === position)!;
      const stat = visibleStats("nfl", position).find(({ key }) => key === "rushTd");
      assert.ok(stat, `Rushing touchdowns should be visible for ${position}`);
      const logs = (await provider.getPlayerLogs(player.id)).slice(0, 3);
      assert.deepEqual(logs.map(({ stats }) => stats.rushTd), [2, 0, undefined]);
      assert.equal(aggregateStat(stat, logs), 1);
    }
  } finally {
    setProvider(snap);
  }
});

test("the engine gives the same forecasts on the phone snapshot as on the source data", async () => {
  await ready;
  for (const sport of SPORT_IDS) {
    const player = (await demo.listPlayers({ sport })).find((p) => p.role === "starter")!;
    const statKey = { nba: "pts", nfl: "passYds", mlb: "hits", nhl: "shots", soccer: "shots" }[sport];
    setProvider(demo);
    const a = await forecastPlayerStat({ playerId: player.id, statKey, threshold: null }).catch((e) => e as Error);
    setProvider(snap);
    const b = await forecastPlayerStat({ playerId: player.id, statKey, threshold: null }).catch((e) => e as Error);
    if (a instanceof Error) {
      assert.ok(b instanceof Error, `${sport}: both should fail the same way`);
      continue;
    }
    assert.ok(!(b instanceof Error), `${sport}: ${(b as Error).message}`);
    assert.ok(Math.abs(a.forecast.projection - b.forecast.projection) < 0.01, `${sport} projection ${a.forecast.projection} vs ${b.forecast.projection}`);
    assert.ok(Math.abs(a.forecast.pOver - b.forecast.pOver) < 0.001, `${sport} pOver`);
    const game = (await demo.listGames({ sport, status: "scheduled" }))[0];
    setProvider(demo);
    const ga = await forecastGame(game);
    setProvider(snap);
    const gb = await forecastGame((await snap.getGame(game.id))!);
    assert.ok(Math.abs(ga.pHomeWin - gb.pHomeWin) < 0.001, `${sport} team forecast`);
  }
});
