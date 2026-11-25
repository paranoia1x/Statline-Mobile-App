import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScenarios } from "../src/lib/parse/pick";
import { generateUniverse } from "./fixtures/demo/generate";

const u = generateUniverse();
const dir = { players: u.players, teams: u.teams };
const ref = new Date("2026-11-14T12:00:00Z");

test("extracts player, stat, threshold, side, opponent and date", () => {
  const [s] = parseScenarios("Tobias Delacroix over 16.5 points vs SLC 11/15", dir, ref);
  assert.equal(s.playerName, "Tobias Delacroix");
  assert.equal(s.statKey, "pts");
  assert.equal(s.threshold, 16.5);
  assert.equal(s.side, "over");
  assert.equal(s.opponentId, "nba-slc");
  assert.equal(s.gameDate, "2026-11-15");
  assert.deepEqual(s.issues, []);
});

test("full-name match wins over another player sharing the surname", () => {
  const out = parseScenarios("Tobias Delacroix 16.5 pts\nWes Mercer passing yards u250.5\nCallum Underhill rush yds o85.5", dir, ref);
  assert.deepEqual(out.map((s) => s.playerName), ["Tobias Delacroix", "Wes Mercer", "Callum Underhill"]);
  assert.equal(out[1].statKey, "passYds");
  assert.equal(out[1].side, "under");
  assert.equal(out[1].threshold, 250.5);
  assert.equal(out[2].statKey, "rushYds");
  assert.equal(out[2].side, "over");
});

test("tolerates a one-character OCR error in the surname", () => {
  const [s] = parseScenarios("Tobias Delacr0ix MORE 3.5 assists", dir, ref);
  assert.equal(s.playerName, "Tobias Delacroix");
  assert.equal(s.statKey, "ast");
  assert.equal(s.side, "over");
});

test("combo stat aliases are preferred over their parts", () => {
  const [s] = parseScenarios("Tobias Delacroix pts+reb+ast 24.5", dir, ref);
  assert.equal(s.statKey, "pra");
});

test("returns nothing for unknown names", () => {
  assert.equal(parseScenarios("Somebody Unknown over 20.5 points", dir, ref).length, 0);
});

test("stat words are never read as bare surnames", () => {
  const fake = [
    { ...u.players[0], id: "x-point", firstName: "Brayden", lastName: "Point", name: "Brayden Point", sport: "nhl" as const },
  ];
  const out = parseScenarios("Tobias Delacroix over 19.5 points", { players: [...u.players, ...fake], teams: u.teams }, ref);
  assert.deepEqual(out.map((s) => s.playerName), ["Tobias Delacroix"]);
  assert.equal(out[0].statKey, "pts");
});

test("a first name is never read as another player's surname", () => {
  const extra = [
    { ...u.players[0], id: "x-mcdavid", firstName: "Connor", lastName: "McDavid", name: "Connor McDavid", sport: "nhl" as const },
    { ...u.players[0], id: "x-connor", firstName: "Kyle", lastName: "Connor", name: "Kyle Connor", sport: "nhl" as const },
  ];
  const out = parseScenarios("Connor McDavid over 3.5 shots on goal", { players: [...u.players, ...extra], teams: u.teams }, ref);
  assert.deepEqual(out.map((s) => s.playerName), ["Connor McDavid"]);
});

test("reads a PrizePicks-style board (line before stat, More/Less), including combo stats", () => {
  const board = `Tobias Delacroix
HCT - G
vs SLC Sun 7:45pm
24.5
Pts+Rebs+Asts
Less More
Tobias Delacroix
HCT - G
6.5
Rebs+Asts
Less More`;
  const out = parseScenarios(board, dir, ref);
  const pra = out.find((s) => s.statKey === "pra");
  assert.ok(pra, "PRA line read");
  assert.equal(pra!.threshold, 24.5);
  const ra = out.find((s) => s.statKey === "ra");
  assert.ok(ra, "Rebs+Asts read as the combo, not as rebounds");
  assert.equal(ra!.threshold, 6.5);
});
