import { test } from "node:test";
import assert from "node:assert/strict";
import { fairAmerican, impliedProbability, parseSlip } from "../src/lib/parse/parlay";
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
