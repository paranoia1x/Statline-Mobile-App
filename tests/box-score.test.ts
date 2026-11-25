import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoxScore, type ScreenshotWord } from "../src/lib/parse/box-score";

function row(y: number, ...cells: [number, string, number?][]): ScreenshotWord[] {
  return cells.flatMap(([left, text, confidence = 95]) => {
    let x = left;
    return text.split(" ").map((word) => {
      const bbox = { x0: x, x1: x + word.length * 7, y0: y, y1: y + 14 };
      x = bbox.x1 + 5;
      return { text: word, confidence, bbox };
    });
  });
}

const players = [
  { id: "nba-1", name: "Nikola Jokić", firstName: "Nikola", lastName: "Jokić" },
  { id: "nba-2", name: "Jamal Murray", firstName: "Jamal", lastName: "Murray" },
];

test("reads named box-score columns without shifting values into blank cells", () => {
  const words = [
    ...row(18, [12, "STARTERS"], [220, "MIN"], [290, "FG"], [350, "REB"], [412, "PTS"]),
    ...row(42, [12, "N. Jokic"], [218, "32:44"], [284, "10-17"], [353, "12"], [412, "26"]),
    ...row(66, [12, "Jamal Murray"], [219, "33:27"], [351, "4", 32], [412, "15"]),
    ...row(88, [12, "TOTAL"], [219, "66:11"], [284, "15-29"], [351, "16"], [412, "41"]),
  ];
  const [table] = readBoxScore(words.reverse(), "nba", players);
  assert.deepEqual(table.columns, ["MIN", "FG", "REB", "PTS"]);
  assert.deepEqual(table.rows, [
    { playerId: "nba-1", name: "Nikola Jokić", values: ["32:44", "10-17", "12", "26"] },
    { playerId: "nba-2", name: "Jamal Murray", values: ["33:27", null, null, "15"] },
  ]);
});

test("reads fantasy roster columns and keeps other layouts out of results", () => {
  const header = row(10, [12, "PLAYER"], [210, "POS"], [268, "TEAM"], [351, "FPTS"]);
  const roster = row(32, [12, "Jamal Murray"], [216, "PG"], [268, "DEN"], [351, "32.50"]);
  assert.deepEqual(readBoxScore([...header, ...roster], "nba", players)[0]?.rows[0]?.values, ["PG", "DEN", "32.50"]);
  assert.deepEqual(readBoxScore(roster, "nba", players), []);
  assert.deepEqual(readBoxScore([...header, ...row(32, [12, "Jamal Murray"], [351, "48%"])], "nba", players), []);
  const ambiguous = [...players, { id: "nba-3", name: "John Murray", firstName: "John", lastName: "Murray" }];
  assert.deepEqual(readBoxScore([...header, ...row(32, [12, "J. Murray"], [351, "32.50"])], "nba", ambiguous), []);
});
