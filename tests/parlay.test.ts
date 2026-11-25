import { test } from "node:test";
import assert from "node:assert/strict";
import { americanFromDecimal, fairAmerican, impliedProbability, marketPrice, parseSlip } from "../src/lib/parse/parlay";
import { generateUniverse } from "./fixtures/demo/generate";
import type { Team } from "../src/lib/types";

const u = generateUniverse();
const ref = new Date("2026-11-14T12:00:00Z");
const nbaTeam = u.teams.find((t) => t.id === "nba-hct")!;

// extra fixtures for the edge cases real slips hit
const thunder: Team = { ...nbaTeam, id: "nba-okt", city: "Oklahoma", name: "Thunder", fullName: "Oklahoma Thunder", abbreviation: "OKT" };
const nbaWolves: Team = { ...nbaTeam, id: "nba-cwv", city: "Coastal", name: "Wolves", fullName: "Coastal Wolves", abbreviation: "CWV" };
const kingsportSurname = { ...u.players.find((p) => p.sport === "nfl")!, id: "nfl-px", name: "Rory Kingsport", firstName: "Rory", lastName: "Kingsport" };
const dir = { players: [...u.players, kingsportSurname], teams: [...u.teams, thunder, nbaWolves] };

const nhlPlayer = u.players.find((p) => p.name === "Kofi Quarles")!;

test("reads a mixed slip: player prop, moneyline, spread, total above its matchup, parlay odds", () => {
  const slip = [
    "4 Leg Parlay +1250",
    "Kofi Quarles Over 0.5 Goals +180",
    "Frostburg Wolves @ Kingsport Knights",
    "Blackrock Ravens -140",
    "Moneyline",
    "Harbor City Tides -3.5 -110",
    "Spread",
    "Over 5.5 -105",
    "Total Goals · Frostburg Wolves @ Kingsport Knights",
  ].join("\n");
  const { legs, parlayOdds } = parseSlip(slip, dir, ref);
  assert.equal(parlayOdds, 1250);
  assert.deepEqual(
    legs.map((l) => l.leg.kind),
    ["player", "moneyline", "spread", "total"],
  );
  const [prop, ml, spread, total] = legs;
  assert.equal(prop.leg.kind === "player" && prop.leg.playerId, nhlPlayer.id);
  assert.equal(prop.odds, 180);
  // the matchup header under the prop names the game
  assert.equal((prop.leg as { opponentId?: string }).opponentId, "nhl-kpk");
  assert.deepEqual([ml.leg, ml.odds], [{ kind: "moneyline", teamId: "nhl-brr" }, -140]);
  assert.deepEqual([spread.leg, spread.odds], [{ kind: "spread", teamId: "nba-hct", line: -3.5 }, -110]);
  assert.deepEqual([total.leg, total.odds], [{ kind: "total", teamId: "nhl-fbw", side: "over", line: 5.5, opponentId: "nhl-kpk" }, -105]);
});

test("words inside team names are not players, and 'Thunder' is not 'under'", () => {
  const { legs } = parseSlip("Kingsport Knights ML +120\nOklahoma Thunder -6.5 -110", dir, ref);
  assert.deepEqual(
    legs.map((l) => l.leg),
    [
      { kind: "moneyline", teamId: "nhl-kpk" },
      { kind: "spread", teamId: "nba-okt", line: -6.5 },
    ],
  );
});

test("a nickname inside a full team name does not pull in another team with that nickname", () => {
  const { legs } = parseSlip("Frostburg Wolves Moneyline -140", dir, ref);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].leg.kind === "moneyline" && legs[0].leg.teamId, "nhl-fbw");
  assert.deepEqual(legs[0].issues, []);
});

test("a shared nickname is resolved by the caller's preference", () => {
  const prefer = (c: Team[]) => c.find((t) => t.sport === "nba")!;
  const { legs } = parseSlip("Wolves +4.5 -110", dir, ref, prefer);
  assert.deepEqual(legs[0].leg, { kind: "spread", teamId: "nba-cwv", line: 4.5 });
});

test("a matchup header alone is not a bet", () => {
  const { legs } = parseSlip("Frostburg Wolves @ Kingsport Knights", dir, ref);
  assert.equal(legs.length, 0);
});

test("odds conversions", () => {
  assert.equal(impliedProbability(-150), 0.6);
  assert.equal(impliedProbability(150), 0.4);
  assert.equal(fairAmerican(0.6), -150);
  assert.equal(fairAmerican(0.4), 150);
  assert.equal(fairAmerican(1), null);
});

// ---- prediction-market slips (Kalshi / Polymarket) ----
const nflQb = u.players.find((p) => p.sport === "nfl" && p.positionGroup === "QB")!;
const nflWr = u.players.find((p) => p.sport === "nfl" && p.positionGroup === "WR" && p.id !== nflQb.id)!;
const nflRb = u.players.find((p) => p.sport === "nfl" && p.positionGroup === "RB")!;

test("reads a Kalshi combo: N+ lines, market prices and cost / max payout", () => {
  // as OCR reads the Kalshi share card (including its misread of "COST")
  const slip = [
    "3 MARKET COMBO Kalshi",
    "COSY MAX PAYOUT",
    "$9.99 $406.50",
    `${nflQb.name}: 22+ passing completions 58%`,
    `${nflWr.name}: 6+ receptions 50%`,
    `${nflRb.name}: 1+ rushing touchdowns 8%`,
  ].join("\n");
  const r = parseSlip(slip, dir, ref);
  assert.deepEqual(r.stake, { cost: 9.99, payout: 406.5 });
  assert.equal(r.parlayOdds, 3969);
  assert.equal(r.legs.length, 3);
  const [a, b, c] = r.legs.map((l) => l.leg as { playerId: string; statKey: string; line: number; side: string });
  assert.deepEqual([a.playerId, a.statKey, a.line, a.side], [nflQb.id, "cmp", 21.5, "over"]);
  assert.deepEqual([b.playerId, b.statKey, b.line, b.side], [nflWr.id, "rec", 5.5, "over"]);
  assert.deepEqual([c.playerId, c.statKey, c.line, c.side], [nflRb.id, "rushTd", 0.5, "over"]);
  // the market price becomes the leg's fair odds (58% → -138, 50% → -100 i.e. even, 8% → +1150)
  assert.deepEqual(r.legs.map((l) => l.odds), [-138, -100, 1150]);
});

test("reads Polymarket-style yes/no prices and touchdown wording", () => {
  const r = parseSlip(`${nflRb.name} anytime touchdown scorer   No 71¢\n${nflQb.name} pass+rush yds over 265.5   Yes 44¢`, dir, ref);
  const [td, yds] = r.legs;
  assert.deepEqual([td.leg.kind === "player" && td.leg.statKey, (td.leg as { line: number }).line, (td.leg as { side: string }).side], ["td", 0.5, "under"]);
  assert.equal(td.odds, -245);
  assert.deepEqual([(yds.leg as { statKey: string }).statKey, (yds.leg as { line: number }).line, (yds.leg as { side: string }).side], ["passRushYds", 265.5, "over"]);
});

test("prediction-market spreads ('win by over 3.5') and stake/payout helpers", () => {
  const r = parseSlip("Kingsport Knights win by over 1.5 goals  Yes 35%", dir, ref);
  assert.deepEqual(r.legs[0].leg, { kind: "spread", teamId: "nhl-kpk", line: -1.5 });
  assert.equal(marketPrice("Yes 58¢"), 0.58);
  assert.equal(marketPrice("6+ receptions 50%"), 0.5);
  assert.equal(marketPrice("Over 22.5 -110"), null);
  assert.equal(americanFromDecimal(2), 100);
  assert.equal(americanFromDecimal(1.5), -200);
  assert.deepEqual(parseSlip("Wager $10.00\nTo win $35.00", dir, ref).stake, { cost: 10, payout: 45 });
});
