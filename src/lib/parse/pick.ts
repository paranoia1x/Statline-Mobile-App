/**
 * Extracts hypothetical player-stat scenarios from free text (pasted or OCR).
 * Pure function: receives the player/team directory so it can run anywhere.
 * Everything extracted is shown to the user for confirmation before analysis.
 */
import type { Player, SportId, Team } from "@/lib/types";

export interface ParsedScenario {
  raw: string;
  playerId: string | null;
  playerName: string | null;
  sport: SportId | null;
  teamId: string | null;
  opponentId: string | null;
  statKey: string | null;
  threshold: number | null;
  side: "over" | "under" | null;
  gameDate: string | null; // YYYY-MM-DD
  issues: string[];
  matchScore: number; // 0..1 confidence in the player match
}

/** Stat names that are combos/fantasy scores the model does not forecast (key ""). Checked first. */
const UNMODELLED: [string, string][] = [
  ["rebs+asts", ""], ["pts+rebs", ""], ["pts+asts", ""], ["blks+stls", ""], ["fantasy score", ""], ["fantasy points", ""],
  ["hits+runs+rbis", ""], ["pass+rush yds", ""], ["rush+rec yds", ""], ["rush+rec tds", ""], ["goals+assists", ""], ["dunks", ""],
  ["1st 3 minutes", ""], ["first 3 minutes", ""], ["1h ", ""], ["1q ", ""],
];

const STAT_ALIASES: Record<SportId, [string, string][]> = {
  nba: [
    ...UNMODELLED,
    ["pts+rebs+asts", "pra"], ["3-pt made", "fg3m"], ["3-pointers made", "fg3m"], ["rebs", "reb"], ["asts", "ast"],
    ["blocked shots", "blk"], ["steals", "stl"],
    ["pts+reb+ast", "pra"], ["pts + reb + ast", "pra"], ["points + rebounds + assists", "pra"], ["pra", "pra"],
    ["three pointers made", "fg3m"], ["three-pointers", "fg3m"], ["3-pointers", "fg3m"], ["threes", "fg3m"], ["3pm", "fg3m"], ["3pt", "fg3m"],
    ["points", "pts"], ["pts", "pts"], ["rebounds", "reb"], ["reb", "reb"], ["assists", "ast"], ["ast", "ast"],
    ["steals", "stl"], ["stl", "stl"], ["blocks", "blk"], ["blk", "blk"], ["turnovers", "tov"], ["tov", "tov"],
  ],
  nfl: [
    ...UNMODELLED,
    ["pass completions", "cmp"], ["receiving yds", "recYds"],
    ["passing yards", "passYds"], ["pass yds", "passYds"], ["pass yards", "passYds"], ["passing yds", "passYds"],
    ["rushing yards", "rushYds"], ["rush yds", "rushYds"], ["rush yards", "rushYds"], ["rushing yds", "rushYds"],
    ["receiving yards", "recYds"], ["rec yds", "recYds"], ["rec yards", "recYds"], ["receiving yds", "recYds"],
    ["receptions", "rec"], ["catches", "rec"], ["rec", "rec"], ["targets", "targets"],
    ["passing touchdowns", "passTd"], ["pass tds", "passTd"], ["pass td", "passTd"], ["completions", "cmp"], ["cmp", "cmp"],
    ["pass attempts", "att"], ["attempts", "att"], ["interceptions", "int"], ["ints", "int"],
    ["carries", "carries"], ["rush attempts", "carries"], ["touchdowns", "td"], ["anytime td", "td"], ["tds", "td"],
  ],
  mlb: [
    ...UNMODELLED,
    ["hitter strikeouts", "so"], ["earned runs allowed", "er"], ["walks allowed", ""], ["pitcher outs", "outs"],
    ["total bases", "tb"], ["home runs", "hr"], ["homers", "hr"], ["hr", "hr"], ["rbis", "rbi"], ["rbi", "rbi"],
    ["hits allowed", "hitsAllowed"], ["earned runs", "er"], ["outs recorded", "outs"], ["pitching outs", "outs"],
    ["pitcher strikeouts", "k"], ["strikeouts", "so"], ["ks", "so"], ["walks", "bb"], ["hits", "hits"], ["runs", "runs"],
  ],
  nhl: [
    ...UNMODELLED,
    ["goalie saves", "saves"], ["goals allowed", "ga"],
    ["shots on goal", "sog"], ["sog", "sog"], ["blocked shots", "blk"], ["saves", "saves"], ["goals against", "ga"],
    ["points", "points"], ["pts", "points"], ["goals", "goals"], ["assists", "assists"],
  ],
  soccer: [
    ...UNMODELLED,
    ["goalie saves", "saves"],
    ["shots on target", "sot"], ["sot", "sot"], ["passes attempted", "passAtt"], ["passes", "passAtt"], ["tackles", "tackles"],
    ["saves", "saves"], ["shots", "shots"], ["goals", "goals"], ["assists", "assists"],
  ],
};

const SIDE_WORDS: [RegExp, "over" | "under"][] = [
  [/\b(over|more|higher|above|o)\b/i, "over"],
  [/\b(under|less|fewer|lower|below|u)\b/i, "under"],
];

/** Words that appear in stat descriptions and must never be read as a bare surname. */
const COMMON_WORDS = new Set(
  [
    ...Object.values(STAT_ALIASES).flatMap((list) => list.flatMap(([alias]) => alias.split(/\s+/))),
    "over", "under", "more", "less", "higher", "lower", "above", "below", "vs", "at", "game", "games", "point", "points",
    "goal", "goals", "save", "saves", "hit", "hits", "run", "runs", "yards", "shot", "shots", "block", "blocks", "pick", "picks", "line",
  ].map((w) => w.toLowerCase()),
);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9.+\s/-]/g, " ");

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const close = (a: string, b: string) => (b.length >= 5 ? lev(a, b) <= 1 : a === b);

interface Hit {
  player: Player;
  tokenIndex: number; // first token of the name
  lastIndex: number; // token holding the last name
  score: number;
}

function findPlayers(tokens: string[], players: Player[]): Hit[] {
  const hits: Hit[] = [];
  for (const p of players) {
    const last = p.lastName.toLowerCase();
    const first = p.firstName.toLowerCase();
    for (let i = 0; i < tokens.length; i++) {
      if (!close(tokens[i], last)) continue;
      const prev = tokens[i - 1] ?? "";
      let score = 0.55;
      let start = i;
      if (close(prev, first)) (score = 1), (start = i - 1);
      else if (prev.replace(".", "") === first[0] && tokens[i] === last) (score = 0.85), (start = i - 1);
      // a surname on its own must match exactly and must not be an ordinary stat word ("points", "saves"...)
      if (score === 0.55 && (tokens[i] !== last || COMMON_WORDS.has(tokens[i]))) continue;
      hits.push({ player: p, tokenIndex: start, lastIndex: i, score });
    }
  }
  // strongest matches claim their tokens first; weaker matches overlapping a claimed name are dropped
  // (so the first name in "Connor McDavid" is never read as the surname of "Kyle Connor")
  const claimed = new Set<number>();
  const accepted: Hit[] = [];
  for (const h of hits.sort((a, b) => b.score - a.score || a.tokenIndex - b.tokenIndex)) {
    const span = Array.from({ length: h.lastIndex - h.tokenIndex + 1 }, (_, k) => h.tokenIndex + k);
    if (span.some((t) => claimed.has(t))) continue;
    span.forEach((t) => claimed.add(t));
    accepted.push(h);
  }
  return accepted.sort((a, b) => a.tokenIndex - b.tokenIndex);
}

function parseDate(seg: string, refYear: number): string | null {
  const iso = seg.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const md = seg.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (md) {
    const y = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : refYear;
    return `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  }
  const mon = seg.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`, "i"));
  if (mon) return `${refYear}-${String(MONTHS.indexOf(mon[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-${mon[2].padStart(2, "0")}`;
  return null;
}

export function parseScenarios(text: string, directory: { players: Player[]; teams: Team[] }, refDate = new Date()): ParsedScenario[] {
  // drop clock times ("7:45pm") and odds-style prices ("-110") so they are never read as lines
  const cleaned = norm(text.replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ").replace(/(^|\s)[+-]\d{3,4}\b/g, " "));
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const hits = findPlayers(tokens, directory.players);
  const out: ParsedScenario[] = [];

  hits.forEach((hit, idx) => {
    const end = idx + 1 < hits.length ? hits[idx + 1].tokenIndex : tokens.length;
    const segTokens = tokens.slice(hit.tokenIndex, end);
    const seg = " " + segTokens.join(" ") + " ";
    const p = hit.player;
    const issues: string[] = [];

    // statistic
    let statKey: string | null = null;
    for (const [alias, key] of STAT_ALIASES[p.sport]) {
      if (new RegExp(`(^|\\s)${alias.replace(/[+]/g, "\\+")}(\\s|$)`, "i").test(seg)) {
        statKey = key;
        break;
      }
    }
    if (statKey === "") {
      statKey = null;
      issues.push("Combo/fantasy statistic — not modelled");
    } else if (!statKey) issues.push("Statistic not recognised");

    // threshold: a number with optional o/u prefix, excluding dates/jerseys-like tokens next to "/"
    const nameTokens = new Set([p.firstName.toLowerCase(), p.lastName.toLowerCase()]);
    let threshold: number | null = null;
    let side: "over" | "under" | null = null;
    const nums: { value: number; side: "over" | "under" | null; decimal: boolean }[] = [];
    for (const t of segTokens) {
      if (nameTokens.has(t) || t.includes("/") || /^20\d{2}-/.test(t)) continue;
      const m = t.match(/^([ou])?(\d+(?:\.\d+)?)\+?$/);
      if (!m) continue;
      let value = Number(m[2]);
      let sd: "over" | "under" | null = m[1] ? (m[1] === "o" ? "over" : "under") : null;
      if (t.endsWith("+")) (sd = "over"), (value -= 0.5);
      nums.push({ value, side: sd, decimal: m[2].includes(".") || t.endsWith("+") });
    }
    // lines are usually half-points: prefer a decimal number when the text also contains other integers
    const pickNum = nums.find((n) => n.decimal) ?? nums[0];
    if (pickNum) (threshold = pickNum.value), (side = pickNum.side);
    if (threshold == null) issues.push("Threshold not found");
    if (!side) {
      const matched = SIDE_WORDS.filter(([re]) => re.test(seg)).map(([, sd]) => sd);
      // pick'em cards show both "Less" and "More": then no side was chosen
      if (matched.length === 1) side = matched[0];
    }

    // opponent: any team abbreviation / name mentioned other than player's team
    let opponentId: string | null = null;
    for (const t of directory.teams) {
      if (t.sport !== p.sport || t.id === p.teamId) continue;
      const ab = t.abbreviation.toLowerCase();
      if (segTokens.includes(ab) || seg.includes(" " + t.name.toLowerCase() + " ") || seg.includes(" " + t.city.toLowerCase() + " ")) {
        opponentId = t.id;
        break;
      }
    }

    const gameDate = parseDate(seg, refDate.getUTCFullYear());
    if (hit.score < 1) issues.push(`Player matched on ${hit.score >= 0.85 ? "initial + last name" : "last name only"} — please confirm`);
    out.push({
      raw: segTokens.join(" ").slice(0, 160),
      playerId: p.id,
      playerName: p.name,
      sport: p.sport,
      teamId: p.teamId,
      opponentId,
      statKey,
      threshold,
      side,
      gameDate,
      issues,
      matchScore: hit.score,
    });
  });

  // de-duplicate identical scenarios
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.playerId}|${s.statKey}|${s.threshold}|${s.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function statAliasesFor(sport: SportId) {
  return STAT_ALIASES[sport];
}
