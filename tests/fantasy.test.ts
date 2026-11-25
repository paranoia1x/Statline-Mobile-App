import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DEMO_NOW = "2026-11-14T12:00:00Z";
import { setProvider } from "../src/lib/data";
import { getFormat, scoreGame, paTier } from "../src/lib/fantasy/formats";
import { impliedScores, mlToProb } from "../src/lib/engine/odds";
import { weatherEffect } from "../src/lib/fantasy/engine";
import { getFantasyBoard } from "../src/lib/fantasy/board";
import { fantasyBacktest } from "../src/lib/fantasy/backtest";
import { SPORT_IDS } from "../src/lib/types";
import { DemoProvider } from "./fixtures/demo";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("NFL PPR / half / standard scoring", () => {
  const line = { passYds: 250, passTd: 2, int: 1, rushYds: 30, rushTd: 1, rec: 0, recYds: 0, fumLost: 1 };
  // 10 + 8 - 2 + 3 + 6 - 2
  near(scoreGame(getFormat("nfl-ppr", "nfl"), "QB", line, null, 40)!, 23);
  const wr = { rec: 6, recYds: 85, recTd: 1 };
  near(scoreGame(getFormat("nfl-ppr", "nfl"), "WR", wr, null, 8)!, 6 + 8.5 + 6);
  near(scoreGame(getFormat("nfl-half", "nfl"), "WR", wr, null, 8)!, 3 + 8.5 + 6);
  near(scoreGame(getFormat("nfl-std", "nfl"), "WR", wr, null, 8)!, 8.5 + 6);
  near(scoreGame(getFormat("nfl-ppr", "nfl"), "K", { fgm: 2, fga: 3, xpm: 3 }, null, 6)!, 6 - 1 + 3);
  assert.equal(paTier(0), 10);
  assert.equal(paTier(17), 1);
  assert.equal(paTier(40), -4);
  near(scoreGame(getFormat("nfl-ppr", "nfl"), "DST", { sacks: 3, takeaways: 2, defTd: 1, pointsAllowed: 10 }, null, 60)!, 3 + 4 + 6 + 4);
});

test("NBA and NHL DFS scoring with bonuses", () => {
  const td = { pts: 20, reb: 11, ast: 10, stl: 1, blk: 0, tov: 3, fg3m: 2 };
  // 20 + 1 + 13.75 + 15 + 2 - 1.5 + DD 1.5 + TD 3
  near(scoreGame(getFormat("nba-dk", "nba"), "G", td, null, 36)!, 54.75);
  near(scoreGame(getFormat("nba-fd", "nba"), "G", td, null, 36)!, 20 + 13.2 + 15 + 3 - 3);
  const sk = { goals: 1, assists: 2, sog: 5, blk: 1 };
  // 8.5 + 10 + 7.5 + 1.3 + 5+ SOG 3 + 3+ points 3
  near(scoreGame(getFormat("nhl-dk", "nhl"), "F", sk, null, 18)!, 33.3);
  const gk = { saves: 30, ga: 0 };
  near(scoreGame(getFormat("nhl-dk", "nhl"), "G", gk, { scoreFor: 2, scoreAgainst: 0, won: true }, 60)!, 21 + 6 + 4);
});

test("implied team totals from the betting line", () => {
  const s = impliedScores({ odds: { spread: -3.5, total: 44.5, homeMl: null, awayMl: null } }, "nfl")!;
  near(s.home, 24);
  near(s.away, 20.5);
  near(mlToProb(-150)!, 0.6);
  near(mlToProb(150)!, 0.4);
  const h = impliedScores({ odds: { spread: -1.5, total: 6.5, homeMl: -170, awayMl: 145 } }, "nhl")!;
  near(h.home + h.away, 6.5, 1e-9);
  assert.ok(h.home > h.away, "favourite is expected to score more");
  assert.equal(impliedScores({ odds: null }, "nba"), null);
});

test("weather: wind hurts passing and kicking, helps defenses; domes are neutral", () => {
  const w = { temperatureF: 40, condition: "Cloudy", windMph: 25, precipChance: 10, source: "test" };
  assert.ok(weatherEffect("QB", w, false, false).mult < 0.9);
  assert.ok(weatherEffect("K", w, false, false).mult < weatherEffect("QB", w, false, false).mult);
  assert.ok(weatherEffect("DST", w, false, false).mult > 1);
  assert.equal(weatherEffect("QB", w, true, false).mult, 1);
  const half = weatherEffect("QB", w, false, true).mult;
  near(1 - half, (1 - weatherEffect("QB", w, false, false).mult) / 2, 1e-9);
});

test("fantasy board ranks every relevant player with finite projections", async () => {
  setProvider(new DemoProvider());
  let boards = 0;
  for (const sport of SPORT_IDS) {
    const b = await getFantasyBoard(sport, null, null);
    if (!b.slate) continue;
    boards++;
    assert.ok(b.rows.length > 0, `${sport} rows`);
    for (const r of b.rows) {
      assert.ok(Number.isFinite(r.points) && r.points >= 0, `${sport} ${r.player.name} points ${r.points}`);
      assert.ok(r.floor <= r.points + 1e-9 && r.ceiling >= r.points - 1e-9, `${sport} range`);
    }
    for (const g of b.groups) {
      const ranks = b.rows.filter((r) => r.group === g.id).map((r) => r.rank).sort((x, y) => x - y);
      ranks.forEach((rk, i) => assert.equal(rk, i + 1, `${sport} ${g.id} ranks`));
    }
    const a = await fantasyBacktest(sport);
    assert.ok(a.n === 0 || Number.isFinite(a.mae), `${sport} backtest`);
  }
  assert.ok(boards > 0, "at least one sport has an upcoming slate");
});
