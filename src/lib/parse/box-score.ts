import type { Word } from "tesseract.js";
import { SPORTS } from "@/lib/sports";
import type { Player, SportId } from "@/lib/types";

export type ScreenshotWord = Pick<Word, "text" | "bbox" | "confidence">;
type RosterPlayer = Pick<Player, "id" | "name" | "firstName" | "lastName">;

interface BoxScoreRow {
  playerId: string;
  name: string;
  values: (string | null)[];
}

export interface BoxScoreTable {
  columns: string[];
  rows: BoxScoreRow[];
}

interface Column {
  label: string;
  kind?: "stat" | "team" | "position";
  left: number;
  center: number;
}

const PLAYER_HEADERS = new Set(["player", "players", "name", "starters", "bench"]);
const EXTRA_STATS: Record<SportId, string[]> = {
  nba: ["FG", "3PT", "FT", "TO", "+/-", "OREB", "DREB", "PF"],
  nfl: ["C/ATT", "YDS", "AVG", "TD", "LNG", "QBR", "RTG", "SACKS", "FUM", "LOST", "XP", "FG"],
  mlb: ["AB", "H", "R", "BB", "SO", "K", "IP", "PITCHES", "ERA"],
  nhl: ["G", "A", "PTS", "S", "SOG", "+/-", "PIM", "TOI", "SV", "SV%"],
  soccer: ["G", "A", "SH", "SOT", "SV", "YC", "RC"],
};

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const nameKey = (text: string) => normalize(text).replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
const columnKey = (text: string) => normalize(text).replace(/\s+/g, " ").replace(/[.:]+$/, "").trim();
const middleY = (word: ScreenshotWord) => (word.bbox.y0 + word.bbox.y1) / 2;
const height = (word: ScreenshotWord) => word.bbox.y1 - word.bbox.y0;

/** Tesseract often detects widely spaced table cells as separate lines. */
function visualRows(words: ScreenshotWord[]): ScreenshotWord[][] {
  const lines: ScreenshotWord[][] = [];
  for (const word of words.filter((w) => w.text.trim()).sort((a, b) => middleY(a) - middleY(b))) {
    const current = lines[lines.length - 1];
    const first = current?.[0];
    if (first && middleY(word) - middleY(first) < Math.max(height(word), height(first)) * 0.56) current.push(word);
    else lines.push([word]);
  }
  return lines.map((line) => line.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

function readHeader(line: ScreenshotWord[], stats: Set<string>): Column[] | null {
  if (!line[0] || !PLAYER_HEADERS.has(columnKey(line[0].text))) return null;
  const metrics = line.slice(1);
  const columns: Column[] = [];
  for (let index = 0; index < metrics.length; index++) {
    const first = metrics[index];
    let lastIndex = index;
    let label = first.text;
    // A multiword heading is one column only if its words sit close together.
    for (let end = index + 1; end < Math.min(index + 3, metrics.length); end++) {
      if (metrics[end].bbox.x0 - metrics[end - 1].bbox.x1 > height(first) * 0.7) break;
      const phrase = metrics.slice(index, end + 1).map((word) => word.text).join(" ");
      if (stats.has(columnKey(phrase))) {
        label = phrase;
        lastIndex = end;
      }
    }
    const key = columnKey(label);
    const kind = key === "team" ? "team" : key === "pos" || key === "position" ? "position" : stats.has(key) ? "stat" : undefined;
    columns.push({ label, kind, left: first.bbox.x0, center: (first.bbox.x0 + metrics[lastIndex].bbox.x1) / 2 });
    index = lastIndex;
  }
  return columns.some((column) => column.kind) ? columns : null;
}

function readValue(column: Column, words: ScreenshotWord[]): string | null {
  if (!words.length || words.some((word) => word.confidence < 55)) return null;
  const value = words.map((word) => word.text).join("").replace(/[−–]/g, "-");
  if (column.kind === "team" || column.kind === "position") return /^[A-Z]{1,5}(?:\/[A-Z]{1,5})?$/.test(value) ? value : null;
  const percent = column.label.includes("%") ? "%?" : "";
  const pattern = new RegExp("^(?:[+-]?\\d+(?:\\.\\d+)?" + percent + "|\\d+[:/-]\\d+)$");
  return pattern.test(value) ? value : null;
}

/** Reads roster names and header-aligned stats. Cells that cannot be read are left blank. */
export function readBoxScore(words: ScreenshotWord[], sport: SportId, players: RosterPlayer[]): BoxScoreTable[] {
  const stats = new Set(
    ["MIN", "FPTS", "FP", "FANTASY PTS", "FANTASY POINTS", ...EXTRA_STATS[sport],
      ...SPORTS[sport].stats.flatMap(({ short, label }) => [short, label])].map(columnKey),
  );
  const names = new Map<string, RosterPlayer | null>();
  for (const player of players) {
    for (const key of [nameKey(player.name), nameKey(player.firstName.charAt(0) + " " + player.lastName)]) {
      const existing = names.get(key);
      if (existing === undefined) names.set(key, player);
      else if (existing?.id !== player.id) names.set(key, null);
    }
  }

  const tables: BoxScoreTable[] = [];
  let columns: Column[] = [];
  let table: BoxScoreTable | null = null;
  let firstBoundary = 0;
  for (const line of visualRows(words)) {
    const header = readHeader(line, stats);
    if (header) {
      columns = header;
      const [first, second] = columns;
      firstBoundary = first.left - Math.min(height(line[0]) * 2, second ? (second.center - first.center) / 2 : Infinity);
      table = { columns: columns.filter((column) => column.kind).map(({ label }) => label), rows: [] };
      tables.push(table);
      continue;
    }
    if (!table) continue;
    const name = nameKey(line.filter((word) => word.bbox.x1 <= firstBoundary).map((word) => word.text).join(" "));
    const player = names.get(name);
    if (!player) continue;

    const cells = columns.map(() => [] as ScreenshotWord[]);
    for (const word of line) {
      const x = (word.bbox.x0 + word.bbox.x1) / 2;
      if (x < firstBoundary) continue;
      const index = columns.findIndex((column, i) => !columns[i + 1] || x < (column.center + columns[i + 1].center) / 2);
      const maxOffset = Math.max(height(word) * 2, columns[index].center - columns[index].left);
      if (Math.abs(x - columns[index].center) <= maxOffset) cells[index].push(word);
    }
    const values = columns.flatMap((column, index) => column.kind ? [readValue(column, cells[index])] : []);
    if (values.some((value) => value !== null)) table.rows.push({ playerId: player.id, name: player.name, values });
  }
  return tables.filter((result) => result.rows.length);
}
