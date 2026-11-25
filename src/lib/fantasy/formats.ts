/**
 * Fantasy scoring formats. Each format turns one game's box score into fantasy points.
 *
 * Values follow the common published scoring for each format. Where ESPN's box score doesn't
 * carry a stat a format uses (e.g. NFL field-goal distance, MLB doubles/triples, soccer
 * crosses and tackles), the rule says so in its label and an approximation is used.
 */
import type { SportId } from "@/lib/types";

/** Result context for scoring rules that depend on the game (goalie wins, clean sheets…). */
export interface GameResult {
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
}

export interface ScoringRule {
  label: string;
  pts: number;
  /** Units earned in a game (multiplied by pts). */
  value: (s: Record<string, number>, g: GameResult | null, minutes: number) => number;
  /** Bonus rules are shown separately and earn `pts` once when value() is 1. */
  bonus?: boolean;
}

export interface ScoringFormat {
  id: string;
  sport: SportId;
  label: string;
  short: string;
  note: string;
  /** Position groups this format projects, in display order. */
  groups: string[];
  rules: (group: string) => ScoringRule[];
}

const k = (key: string) => (s: Record<string, number>) => s[key] ?? 0;
const atLeast = (key: string, n: number) => (s: Record<string, number>) => ((s[key] ?? 0) >= n ? 1 : 0);
const rule = (label: string, pts: number, value: ScoringRule["value"]): ScoringRule => ({ label, pts, value });
const bonus = (label: string, pts: number, value: ScoringRule["value"]): ScoringRule => ({ label, pts, value, bonus: true });

// ---------------------------------------------------------------- NFL
function nflRules(rec: number) {
  return (group: string): ScoringRule[] => {
    if (group === "K")
      return [
        rule("Field goal made (distance bonuses not in box score)", 3, k("fgm")),
        rule("Field goal missed", -1, (s) => Math.max(0, (s.fga ?? 0) - (s.fgm ?? 0))),
        rule("Extra point made", 1, k("xpm")),
      ];
    if (group === "DST")
      return [
        rule("Sack", 1, k("sacks")),
        rule("Takeaway (INT or fumble recovery)", 2, k("takeaways")),
        rule("Defensive TD", 6, k("defTd")),
        rule("Points allowed (0 → +10 … 35+ → −4)", 1, (s) => paTier(s.pointsAllowed ?? 0)),
      ];
    return [
      rule("Passing yard", 0.04, k("passYds")),
      rule("Passing TD", 4, k("passTd")),
      rule("Interception", -2, k("int")),
      rule("Rushing yard", 0.1, k("rushYds")),
      rule("Rushing TD", 6, k("rushTd")),
      ...(rec ? [rule("Reception", rec, k("rec"))] : []),
      rule("Receiving yard", 0.1, k("recYds")),
      rule("Receiving TD", 6, k("recTd")),
      rule("Return TD", 6, k("retTd")),
      rule("Fumble lost", -2, k("fumLost")),
    ];
  };
}
/** Standard points-allowed tiers for team defenses. */
export function paTier(pa: number) {
  return pa === 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4;
}
const NFL_GROUPS = ["QB", "RB", "WR", "TE", "K", "DST"];

// ---------------------------------------------------------------- NBA
const nbaDk = (): ScoringRule[] => [
  rule("Point", 1, k("pts")),
  rule("3-pointer made", 0.5, k("fg3m")),
  rule("Rebound", 1.25, k("reb")),
  rule("Assist", 1.5, k("ast")),
  rule("Steal", 2, k("stl")),
  rule("Block", 2, k("blk")),
  rule("Turnover", -0.5, k("tov")),
  bonus("Double-double", 1.5, (s) => (doubles(s) >= 2 ? 1 : 0)),
  bonus("Triple-double", 3, (s) => (doubles(s) >= 3 ? 1 : 0)),
];
const doubles = (s: Record<string, number>) => ["pts", "reb", "ast", "stl", "blk"].filter((x) => (s[x] ?? 0) >= 10).length;
const nbaFd = (): ScoringRule[] => [
  rule("Point", 1, k("pts")),
  rule("Rebound", 1.2, k("reb")),
  rule("Assist", 1.5, k("ast")),
  rule("Steal", 3, k("stl")),
  rule("Block", 3, k("blk")),
  rule("Turnover", -1, k("tov")),
];
const nbaEspn = (): ScoringRule[] => [
  rule("Point", 1, k("pts")),
  rule("3-pointer made", 1, k("fg3m")),
  rule("Field goal made", 2, k("fgm")),
  rule("Field goal attempt", -1, k("fga")),
  rule("Free throw made", 1, k("ftm")),
  rule("Free throw attempt", -1, k("fta")),
  rule("Rebound", 1, k("reb")),
  rule("Assist", 2, k("ast")),
  rule("Steal", 4, k("stl")),
  rule("Block", 4, k("blk")),
  rule("Turnover", -2, k("tov")),
];

// ---------------------------------------------------------------- NHL
const nhlDk = (group: string): ScoringRule[] =>
  group === "G"
    ? [
        rule("Save", 0.7, k("saves")),
        rule("Goal against", -3.5, k("ga")),
        bonus("Win (started and team won)", 6, (_s, g, m) => (g?.won && m >= 30 ? 1 : 0)),
        bonus("Shutout", 4, (s, _g, m) => ((s.ga ?? 1) === 0 && m >= 55 ? 1 : 0)),
        bonus("35+ saves", 3, atLeast("saves", 35)),
      ]
    : [
        rule("Goal", 8.5, k("goals")),
        rule("Assist", 5, k("assists")),
        rule("Shot on goal", 1.5, k("sog")),
        rule("Blocked shot", 1.3, k("blk")),
        bonus("Hat trick", 3, atLeast("goals", 3)),
        bonus("5+ shots on goal", 3, atLeast("sog", 5)),
        bonus("3+ blocked shots", 3, atLeast("blk", 3)),
        bonus("3+ points", 3, (s) => ((s.goals ?? 0) + (s.assists ?? 0) >= 3 ? 1 : 0)),
      ];
const nhlFd = (group: string): ScoringRule[] =>
  group === "G"
    ? [
        rule("Save", 0.8, k("saves")),
        rule("Goal against", -4, k("ga")),
        bonus("Win (started and team won)", 12, (_s, g, m) => (g?.won && m >= 30 ? 1 : 0)),
        bonus("Shutout", 8, (s, _g, m) => ((s.ga ?? 1) === 0 && m >= 55 ? 1 : 0)),
      ]
    : [
        rule("Goal", 12, k("goals")),
        rule("Assist", 8, k("assists")),
        rule("Shot on goal", 1.6, k("sog")),
        rule("Blocked shot", 1.6, k("blk")),
      ];

// ---------------------------------------------------------------- MLB
const mlbDk = (group: string): ScoringRule[] =>
  group === "SP"
    ? [
        rule("Out recorded (2.25 per inning)", 0.75, k("outs")),
        rule("Strikeout", 2, k("k")),
        rule("Earned run", -2, k("er")),
        rule("Hit allowed", -0.6, k("hitsAllowed")),
        rule("Walk allowed", -0.6, k("bbAllowed")),
        bonus("Win (5+ innings and team won)", 4, (s, g) => (g?.won && (s.outs ?? 0) >= 15 ? 1 : 0)),
      ]
    : [
        // the box score has hits and home runs but not doubles/triples: other hits use the league mix (≈3.5)
        rule("Hit other than a home run (single 3 / double 5 / triple 8, league mix)", 3.5, (s) => Math.max(0, (s.hits ?? 0) - (s.hr ?? 0))),
        rule("Home run", 10, k("hr")),
        rule("Run", 2, k("runs")),
        rule("RBI", 2, k("rbi")),
        rule("Walk", 2, k("bb")),
      ];

// ---------------------------------------------------------------- Soccer
const soccerDk = (group: string): ScoringRule[] => {
  if (group === "GK")
    return [
      rule("Save", 2, k("saves")),
      rule("Goal conceded", -2, (_s, g, m) => (g && m >= 45 ? g.scoreAgainst : 0)),
      bonus("Clean sheet (60+ min)", 5, (_s, g, m) => (g && g.scoreAgainst === 0 && m >= 60 ? 1 : 0)),
      bonus("Win", 5, (_s, g, m) => (g?.won && m >= 45 ? 1 : 0)),
    ];
  return [
    rule("Goal", 10, k("goals")),
    rule("Assist", 6, k("assists")),
    rule("Shot", 1, k("shots")),
    rule("Shot on target", 1, k("sot")),
    ...(group === "DF" ? [bonus("Clean sheet (60+ min)", 3, (_s: Record<string, number>, g: GameResult | null, m: number) => (g && g.scoreAgainst === 0 && m >= 60 ? 1 : 0))] : []),
  ];
};

export const FORMATS: ScoringFormat[] = [
  { id: "nfl-ppr", sport: "nfl", label: "PPR", short: "PPR", note: "Full point per reception. 4-pt passing TDs, 1 pt per 25 passing yards, 1 per 10 rushing/receiving yards.", groups: NFL_GROUPS, rules: nflRules(1) },
  { id: "nfl-half", sport: "nfl", label: "Half PPR", short: "Half", note: "Half a point per reception; otherwise standard scoring.", groups: NFL_GROUPS, rules: nflRules(0.5) },
  { id: "nfl-std", sport: "nfl", label: "Standard", short: "Std", note: "No points for receptions.", groups: NFL_GROUPS, rules: nflRules(0) },
  { id: "nba-dk", sport: "nba", label: "DraftKings", short: "DK", note: "DFS scoring with double-double and triple-double bonuses.", groups: ["G", "F", "C"], rules: nbaDk },
  { id: "nba-fd", sport: "nba", label: "FanDuel / NBA official", short: "FD", note: "Official NBA fantasy scoring, used by FanDuel and Yahoo daily games.", groups: ["G", "F", "C"], rules: nbaFd },
  { id: "nba-espn", sport: "nba", label: "ESPN points league", short: "ESPN", note: "ESPN's default head-to-head points scoring (shot attempts count against you).", groups: ["G", "F", "C"], rules: nbaEspn },
  { id: "nhl-dk", sport: "nhl", label: "DraftKings", short: "DK", note: "DFS scoring with shot, block, point and save bonuses. Short-handed and shootout points aren't in the box score.", groups: ["F", "D", "G"], rules: nhlDk },
  { id: "nhl-fd", sport: "nhl", label: "FanDuel", short: "FD", note: "FanDuel-style skater and goalie scoring (power-play and short-handed points not in the box score).", groups: ["F", "D", "G"], rules: nhlFd },
  { id: "mlb-dk", sport: "mlb", label: "DraftKings", short: "DK", note: "DFS hitter and pitcher scoring. Stolen bases, HBP and extra-base-hit detail aren't in the box score.", groups: ["H", "SP"], rules: mlbDk },
  { id: "soccer-dk", sport: "soccer", label: "DraftKings (box-score stats)", short: "DK", note: "Goals, assists, shots, saves, clean sheets and wins. Passes, crosses and tackles aren't in the box score, so midfielders and defenders score lower than on DraftKings.", groups: ["FW", "MF", "DF", "GK"], rules: soccerDk },
];

export function formatsFor(sport: SportId) {
  return FORMATS.filter((f) => f.sport === sport);
}
export function getFormat(id: string | null | undefined, sport: SportId): ScoringFormat {
  return FORMATS.find((f) => f.id === id && f.sport === sport) ?? formatsFor(sport)[0];
}

/** Fantasy points for one game. Returns null when the line has none of the stats the format scores. */
export function scoreGame(format: ScoringFormat, group: string, stats: Record<string, number>, g: GameResult | null, minutes: number): number | null {
  const rules = format.rules(group);
  let total = 0;
  let any = false;
  for (const r of rules) {
    const v = r.value(stats, g, minutes);
    total += r.pts * v;
    if (v !== 0) any = true;
  }
  // a line with zeros everywhere is still a played game if it has playing time
  return any || minutes > 0 ? Math.round(total * 100) / 100 : null;
}

/** Per-rule breakdown of a projected stat line (for the "how it's scored" table). */
export function breakdown(format: ScoringFormat, group: string, stats: Record<string, number>, g: GameResult | null, minutes: number) {
  return format.rules(group)
    .map((r) => ({ label: r.label, pts: r.pts, bonus: !!r.bonus, units: r.value(stats, g, minutes) }))
    .map((x) => ({ ...x, total: x.units * x.pts }));
}

/** Fantasy positions shown for a sport (NFL adds team defense). */
export const GROUP_LABELS: Record<string, string> = {
  QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DST: "D/ST",
  G: "G", F: "F", C: "C", D: "D", H: "Hitters", SP: "Pitchers", FW: "FWD", MF: "MID", DF: "DEF", GK: "GK",
};
