import type { SportId, TeamGameLog, PlayerGameLog } from "./types";

export type StatFormat = "int" | "dec1" | "dec2" | "pct" | "avg3";
export type StatDist = "count" | "continuous";

/**
 * How an opponent influences a statistic. The forecasting engine compares the
 * opponent's average of `key` (from what it allowed, or what it produced) with
 * the league average to build an opponent adjustment index.
 */
export interface OpponentDimension {
  id: string;
  label: string;
  source: "allowed" | "box";
  key: string;
}

export interface StatDef {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  /** Position groups for which the stat is meaningful. */
  groups: string[];
  forecastable: boolean;
  dist: StatDist;
  dim?: string;
  higherIsBetter?: boolean;
  /** Ratio stats are aggregated as sum(num) * scale / sum(den) rather than a mean of per-game values. */
  ratio?: { num: string | string[]; den: string; scale?: number };
}

export interface TeamMetricDef {
  key: string;
  label: string;
  side: "offense" | "defense";
  format: StatFormat;
  higherIsBetter: boolean;
  description: string;
  compute: (logs: TeamGameLog[]) => number | null;
}

export interface SportDef {
  id: SportId;
  name: string;
  league: string;
  scoreUnit: string;
  playingTimeLabel: string;
  playingTimeShort: string;
  usageLabel: string | null;
  positionGroups: { id: string; label: string }[];
  stats: StatDef[];
  /** Headline stats shown on cards per position group. */
  headline: Record<string, string[]>;
  dims: OpponentDimension[];
  teamMetrics: TeamMetricDef[];
  /** Typical standard deviation of the final margin, used by team forecasting. */
  marginSd: number;
  lowScoring: boolean;
  allowDraw: boolean;
}

// ---------- helpers ----------
const avg = (logs: TeamGameLog[], f: (l: TeamGameLog) => number) =>
  logs.length ? logs.reduce((s, l) => s + f(l), 0) / logs.length : null;
const ratio = (logs: TeamGameLog[], num: (l: TeamGameLog) => number, den: (l: TeamGameLog) => number) => {
  const d = logs.reduce((s, l) => s + den(l), 0);
  return d ? logs.reduce((s, l) => s + num(l), 0) / d : null;
};

export function aggregateStat(def: StatDef, logs: PlayerGameLog[]): number | null {
  if (!logs.length) return null;
  if (def.ratio) {
    const nums = Array.isArray(def.ratio.num) ? def.ratio.num : [def.ratio.num];
    const den = logs.reduce((s, l) => s + (l.stats[def.ratio!.den] ?? 0), 0);
    if (!den) return null;
    const num = logs.reduce((s, l) => s + nums.reduce((a, k) => a + (l.stats[k] ?? 0), 0), 0);
    return (num * (def.ratio.scale ?? 1)) / den;
  }
  const vals = logs.map((l) => l.stats[def.key]).filter((v) => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ---------- NBA ----------
const nba: SportDef = {
  id: "nba",
  name: "NBA",
  league: "Basketball",
  scoreUnit: "pts",
  playingTimeLabel: "Minutes",
  playingTimeShort: "MIN",
  usageLabel: "Usage rate",
  positionGroups: [
    { id: "G", label: "Guard" },
    { id: "F", label: "Forward" },
    { id: "C", label: "Center" },
  ],
  stats: [
    { key: "pts", label: "Points", short: "PTS", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "scoring" },
    { key: "reb", label: "Rebounds", short: "REB", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "rebounding" },
    { key: "ast", label: "Assists", short: "AST", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "playmaking" },
    { key: "pra", label: "Pts + Reb + Ast", short: "PRA", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "scoring" },
    { key: "stl", label: "Steals", short: "STL", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "ballsecurity" },
    { key: "blk", label: "Blocks", short: "BLK", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "interior" },
    { key: "fg3m", label: "Three-pointers made", short: "3PM", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "perimeter" },
    { key: "tov", label: "Turnovers", short: "TOV", format: "dec1", groups: ["G", "F", "C"], forecastable: true, dist: "count", dim: "ballsecurity", higherIsBetter: false },
    { key: "fgPct", label: "Field goal %", short: "FG%", format: "pct", groups: ["G", "F", "C"], forecastable: false, dist: "continuous", ratio: { num: "fgm", den: "fga" } },
    { key: "fg3Pct", label: "Three-point %", short: "3P%", format: "pct", groups: ["G", "F", "C"], forecastable: false, dist: "continuous", ratio: { num: "fg3m", den: "fg3a" } },
    { key: "ftPct", label: "Free throw %", short: "FT%", format: "pct", groups: ["G", "F", "C"], forecastable: false, dist: "continuous", ratio: { num: "ftm", den: "fta" } },
    { key: "usg", label: "Usage rate", short: "USG%", format: "dec1", groups: ["G", "F", "C"], forecastable: false, dist: "continuous" },
  ],
  headline: { G: ["pts", "ast", "fg3m"], F: ["pts", "reb", "ast"], C: ["pts", "reb", "blk"] },
  dims: [
    { id: "scoring", label: "Points allowed", source: "allowed", key: "pts" },
    { id: "rebounding", label: "Rebounds allowed", source: "allowed", key: "reb" },
    { id: "playmaking", label: "Assists allowed", source: "allowed", key: "ast" },
    { id: "perimeter", label: "Threes allowed", source: "allowed", key: "fg3m" },
    { id: "interior", label: "Opponent FG attempts", source: "box", key: "fga" },
    { id: "ballsecurity", label: "Opponent turnovers forced", source: "box", key: "tov" },
  ],
  teamMetrics: [
    { key: "ppg", label: "Points per game", side: "offense", format: "dec1", higherIsBetter: true, description: "Average points scored.", compute: (l) => avg(l, (x) => x.box.pts) },
    { key: "offRtg", label: "Offensive rating", side: "offense", format: "dec1", higherIsBetter: true, description: "Points scored per 100 possessions.", compute: (l) => mul(ratio(l, (x) => x.box.pts, (x) => x.box.poss), 100) },
    { key: "pace", label: "Pace", side: "offense", format: "dec1", higherIsBetter: true, description: "Possessions per game.", compute: (l) => avg(l, (x) => x.box.poss) },
    { key: "fgPct", label: "Field goal %", side: "offense", format: "pct", higherIsBetter: true, description: "Team field goal percentage.", compute: (l) => ratio(l, (x) => x.box.fgm, (x) => x.box.fga) },
    { key: "fg3Pct", label: "Three-point %", side: "offense", format: "pct", higherIsBetter: true, description: "Team three-point percentage.", compute: (l) => ratio(l, (x) => x.box.fg3m, (x) => x.box.fg3a) },
    { key: "apg", label: "Assists per game", side: "offense", format: "dec1", higherIsBetter: true, description: "Average assists.", compute: (l) => avg(l, (x) => x.box.ast) },
    { key: "tovRate", label: "Turnover rate", side: "offense", format: "pct", higherIsBetter: false, description: "Turnovers per possession.", compute: (l) => ratio(l, (x) => x.box.tov, (x) => x.box.poss) },
    { key: "defRtg", label: "Defensive rating", side: "defense", format: "dec1", higherIsBetter: false, description: "Points allowed per 100 possessions.", compute: (l) => mul(ratio(l, (x) => x.allowed.pts, (x) => x.allowed.poss), 100) },
    { key: "papg", label: "Points allowed", side: "defense", format: "dec1", higherIsBetter: false, description: "Average points allowed.", compute: (l) => avg(l, (x) => x.allowed.pts) },
    { key: "rapg", label: "Rebounds allowed", side: "defense", format: "dec1", higherIsBetter: false, description: "Average opponent rebounds.", compute: (l) => avg(l, (x) => x.allowed.reb) },
    { key: "aapg", label: "Assists allowed", side: "defense", format: "dec1", higherIsBetter: false, description: "Average opponent assists.", compute: (l) => avg(l, (x) => x.allowed.ast) },
    { key: "opp3Pct", label: "Opponent 3P%", side: "defense", format: "pct", higherIsBetter: false, description: "Three-point defense: opponent 3P%.", compute: (l) => ratio(l, (x) => x.allowed.fg3m, (x) => x.allowed.fg3a) },
    { key: "oppFgPct", label: "Opponent FG%", side: "defense", format: "pct", higherIsBetter: false, description: "Opponent field goal percentage.", compute: (l) => ratio(l, (x) => x.allowed.fgm, (x) => x.allowed.fga) },
    { key: "rebPct", label: "Rebounding efficiency", side: "defense", format: "pct", higherIsBetter: true, description: "Share of all available rebounds secured.", compute: (l) => ratio(l, (x) => x.box.reb, (x) => x.box.reb + x.allowed.reb) },
    { key: "forcedTov", label: "Forced turnover rate", side: "defense", format: "pct", higherIsBetter: true, description: "Opponent turnovers per possession.", compute: (l) => ratio(l, (x) => x.allowed.tov, (x) => x.allowed.poss) },
  ],
  marginSd: 12.5,
  lowScoring: false,
  allowDraw: false,
};

// ---------- NFL ----------
const nfl: SportDef = {
  id: "nfl",
  name: "NFL",
  league: "Football",
  scoreUnit: "pts",
  playingTimeLabel: "Snap share",
  playingTimeShort: "SNAP%",
  usageLabel: "Opportunity share",
  positionGroups: [
    { id: "QB", label: "Quarterback" },
    { id: "RB", label: "Running back" },
    { id: "WR", label: "Wide receiver" },
    { id: "TE", label: "Tight end" },
    { id: "K", label: "Kicker" },
  ],
  stats: [
    { key: "passYds", label: "Passing yards", short: "PASS YDS", format: "dec1", groups: ["QB"], forecastable: true, dist: "continuous", dim: "pass" },
    { key: "cmp", label: "Completions", short: "CMP", format: "dec1", groups: ["QB"], forecastable: true, dist: "count", dim: "pass" },
    { key: "att", label: "Pass attempts", short: "ATT", format: "dec1", groups: ["QB"], forecastable: true, dist: "count", dim: "passvolume" },
    { key: "passTd", label: "Passing touchdowns", short: "PASS TD", format: "dec1", groups: ["QB"], forecastable: true, dist: "count", dim: "pass" },
    { key: "int", label: "Interceptions", short: "INT", format: "dec1", groups: ["QB"], forecastable: true, dist: "count", dim: "takeaways", higherIsBetter: false },
    { key: "rushYds", label: "Rushing yards", short: "RUSH YDS", format: "dec1", groups: ["QB", "RB"], forecastable: true, dist: "continuous", dim: "run" },
    { key: "carries", label: "Carries", short: "CAR", format: "dec1", groups: ["RB"], forecastable: true, dist: "count", dim: "run" },
    { key: "rec", label: "Receptions", short: "REC", format: "dec1", groups: ["RB", "WR", "TE"], forecastable: true, dist: "count", dim: "pass" },
    { key: "recYds", label: "Receiving yards", short: "REC YDS", format: "dec1", groups: ["RB", "WR", "TE"], forecastable: true, dist: "continuous", dim: "pass" },
    { key: "targets", label: "Targets", short: "TGT", format: "dec1", groups: ["RB", "WR", "TE"], forecastable: true, dist: "count", dim: "passvolume" },
    { key: "td", label: "Scrimmage touchdowns", short: "TD", format: "dec2", groups: ["RB", "WR", "TE"], forecastable: true, dist: "count", dim: "scoring" },
    { key: "cmpPct", label: "Completion %", short: "CMP%", format: "pct", groups: ["QB"], forecastable: false, dist: "continuous", ratio: { num: "cmp", den: "att" } },
    { key: "ypc", label: "Yards per carry", short: "YPC", format: "dec1", groups: ["RB"], forecastable: false, dist: "continuous", ratio: { num: "rushYds", den: "carries" } },
    { key: "fgm", label: "Field goals made", short: "FGM", format: "dec1", groups: ["K"], forecastable: true, dist: "count", dim: "scoring" },
    { key: "xpm", label: "Extra points made", short: "XPM", format: "dec1", groups: ["K"], forecastable: true, dist: "count", dim: "scoring" },
    { key: "kickPts", label: "Kicking points", short: "K PTS", format: "dec1", groups: ["K"], forecastable: true, dist: "count", dim: "scoring" },
    { key: "usage", label: "Opportunity share %", short: "OPP%", format: "dec1", groups: ["RB", "WR", "TE"], forecastable: false, dist: "continuous" },
  ],
  headline: { QB: ["passYds", "passTd", "rushYds"], RB: ["rushYds", "carries", "rec"], WR: ["recYds", "rec", "targets"], TE: ["recYds", "rec", "targets"], K: ["kickPts", "fgm", "xpm"] },
  dims: [
    { id: "pass", label: "Passing yards allowed", source: "allowed", key: "passYds" },
    { id: "passvolume", label: "Opponent pass attempts faced", source: "allowed", key: "passAtt" },
    { id: "run", label: "Rushing yards allowed", source: "allowed", key: "rushYds" },
    { id: "scoring", label: "Points allowed", source: "allowed", key: "pts" },
    { id: "takeaways", label: "Takeaways", source: "allowed", key: "turnovers" },
  ],
  teamMetrics: [
    { key: "ppg", label: "Points per game", side: "offense", format: "dec1", higherIsBetter: true, description: "Average points scored.", compute: (l) => avg(l, (x) => x.box.pts) },
    { key: "passYpg", label: "Passing yards / game", side: "offense", format: "dec1", higherIsBetter: true, description: "Average passing yards.", compute: (l) => avg(l, (x) => x.box.passYds) },
    { key: "rushYpg", label: "Rushing yards / game", side: "offense", format: "dec1", higherIsBetter: true, description: "Average rushing yards.", compute: (l) => avg(l, (x) => x.box.rushYds) },
    { key: "passPct", label: "Pass play frequency", side: "offense", format: "pct", higherIsBetter: true, description: "Share of plays that are designed passes.", compute: (l) => ratio(l, (x) => x.box.passAtt + x.box.sacksTaken, (x) => x.box.passAtt + x.box.sacksTaken + x.box.rushAtt) },
    { key: "rushPct", label: "Rush play frequency", side: "offense", format: "pct", higherIsBetter: true, description: "Share of plays that are designed runs.", compute: (l) => ratio(l, (x) => x.box.rushAtt, (x) => x.box.passAtt + x.box.sacksTaken + x.box.rushAtt) },
    { key: "passRun", label: "Pass-to-run ratio", side: "offense", format: "dec2", higherIsBetter: true, description: "Dropbacks per designed run.", compute: (l) => ratio(l, (x) => x.box.passAtt + x.box.sacksTaken, (x) => x.box.rushAtt) },
    { key: "rzPct", label: "Red-zone TD %", side: "offense", format: "pct", higherIsBetter: true, description: "Touchdowns per red-zone trip.", compute: (l) => ratio(l, (x) => x.box.rzTd, (x) => x.box.rzTrips) },
    { key: "thirdPct", label: "Third-down conversion %", side: "offense", format: "pct", higherIsBetter: true, description: "Third downs converted.", compute: (l) => ratio(l, (x) => x.box.thirdConv, (x) => x.box.thirdAtt) },
    { key: "tempo", label: "Offensive tempo (sec/play)", side: "offense", format: "dec1", higherIsBetter: false, description: "Average seconds between snaps; lower is faster.", compute: (l) => avg(l, (x) => x.box.secPerPlay) },
    { key: "paPct", label: "Play-action frequency", side: "offense", format: "pct", higherIsBetter: true, description: "Share of dropbacks using play action.", compute: (l) => ratio(l, (x) => x.box.playAction, (x) => x.box.passAtt) },
    { key: "explosive", label: "Explosive plays / game", side: "offense", format: "dec1", higherIsBetter: true, description: "Runs of 10+ and passes of 20+ yards.", compute: (l) => avg(l, (x) => x.box.explosive) },
    { key: "papg", label: "Points allowed", side: "defense", format: "dec1", higherIsBetter: false, description: "Average points allowed.", compute: (l) => avg(l, (x) => x.allowed.pts) },
    { key: "passYdsAllowed", label: "Passing yards allowed", side: "defense", format: "dec1", higherIsBetter: false, description: "Pass defense: average passing yards allowed.", compute: (l) => avg(l, (x) => x.allowed.passYds) },
    { key: "rushYdsAllowed", label: "Rushing yards allowed", side: "defense", format: "dec1", higherIsBetter: false, description: "Run defense: average rushing yards allowed.", compute: (l) => avg(l, (x) => x.allowed.rushYds) },
    { key: "ypcAllowed", label: "Yards per carry allowed", side: "defense", format: "dec2", higherIsBetter: false, description: "Run defense strength per attempt.", compute: (l) => ratio(l, (x) => x.allowed.rushYds, (x) => x.allowed.rushAtt) },
    { key: "rzDef", label: "Red-zone TD % allowed", side: "defense", format: "pct", higherIsBetter: false, description: "Opponent touchdowns per red-zone trip.", compute: (l) => ratio(l, (x) => x.allowed.rzTd, (x) => x.allowed.rzTrips) },
    { key: "thirdDef", label: "Third-down % allowed", side: "defense", format: "pct", higherIsBetter: false, description: "Opponent third-down conversion rate.", compute: (l) => ratio(l, (x) => x.allowed.thirdConv, (x) => x.allowed.thirdAtt) },
    { key: "sacks", label: "Sacks / game", side: "defense", format: "dec1", higherIsBetter: true, description: "Average sacks recorded.", compute: (l) => avg(l, (x) => x.allowed.sacksTaken) },
    { key: "pressure", label: "Pressure rate", side: "defense", format: "pct", higherIsBetter: true, description: "Pressures per opponent dropback.", compute: (l) => ratio(l, (x) => x.allowed.pressuresAllowed, (x) => x.allowed.passAtt + x.allowed.sacksTaken) },
    { key: "takeaways", label: "Takeaways / game", side: "defense", format: "dec1", higherIsBetter: true, description: "Interceptions plus fumble recoveries.", compute: (l) => avg(l, (x) => x.allowed.turnovers) },
    { key: "oppCmp", label: "Opponent completion %", side: "defense", format: "pct", higherIsBetter: false, description: "Opponent completion percentage.", compute: (l) => ratio(l, (x) => x.allowed.cmp, (x) => x.allowed.passAtt) },
  ],
  marginSd: 13.5,
  lowScoring: false,
  allowDraw: false,
};

// ---------- MLB ----------
const mlb: SportDef = {
  id: "mlb",
  name: "MLB",
  league: "Baseball",
  scoreUnit: "runs",
  playingTimeLabel: "Plate appearances / innings",
  playingTimeShort: "PA/IP",
  usageLabel: null,
  positionGroups: [
    { id: "H", label: "Hitter" },
    { id: "SP", label: "Starting pitcher" },
  ],
  stats: [
    { key: "hits", label: "Hits", short: "H", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "pitching" },
    { key: "hr", label: "Home runs", short: "HR", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "power" },
    { key: "runs", label: "Runs", short: "R", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "runs" },
    { key: "rbi", label: "RBIs", short: "RBI", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "runs" },
    { key: "tb", label: "Total bases", short: "TB", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "pitching" },
    { key: "so", label: "Strikeouts (batting)", short: "SO", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "strikeouts", higherIsBetter: false },
    { key: "bb", label: "Walks", short: "BB", format: "dec2", groups: ["H"], forecastable: true, dist: "count", dim: "walks" },
    { key: "avg", label: "Batting average", short: "AVG", format: "avg3", groups: ["H"], forecastable: false, dist: "continuous", ratio: { num: "hits", den: "ab" } },
    { key: "k", label: "Strikeouts (pitching)", short: "K", format: "dec1", groups: ["SP"], forecastable: true, dist: "count", dim: "contact" },
    { key: "outs", label: "Outs recorded", short: "OUTS", format: "dec1", groups: ["SP"], forecastable: true, dist: "count", dim: "offense" },
    { key: "er", label: "Earned runs allowed", short: "ER", format: "dec1", groups: ["SP"], forecastable: true, dist: "count", dim: "offense", higherIsBetter: false },
    { key: "hitsAllowed", label: "Hits allowed", short: "HA", format: "dec1", groups: ["SP"], forecastable: true, dist: "count", dim: "hitting", higherIsBetter: false },
    { key: "era", label: "ERA", short: "ERA", format: "dec2", groups: ["SP"], forecastable: false, dist: "continuous", higherIsBetter: false, ratio: { num: "er", den: "outs", scale: 27 } },
    { key: "whip", label: "WHIP", short: "WHIP", format: "dec2", groups: ["SP"], forecastable: false, dist: "continuous", higherIsBetter: false, ratio: { num: ["hitsAllowed", "bbAllowed"], den: "outs", scale: 3 } },
  ],
  headline: { H: ["hits", "hr", "rbi"], SP: ["k", "outs", "er"] },
  dims: [
    { id: "pitching", label: "Hits allowed by staff", source: "allowed", key: "hits" },
    { id: "power", label: "Home runs allowed", source: "allowed", key: "hr" },
    { id: "runs", label: "Runs allowed", source: "allowed", key: "runs" },
    { id: "strikeouts", label: "Staff strikeouts", source: "allowed", key: "so" },
    { id: "walks", label: "Walks allowed", source: "allowed", key: "bb" },
    { id: "contact", label: "Opponent batting strikeouts", source: "box", key: "so" },
    { id: "offense", label: "Opponent runs scored", source: "box", key: "runs" },
    { id: "hitting", label: "Opponent hits", source: "box", key: "hits" },
  ],
  teamMetrics: [
    { key: "rpg", label: "Runs per game", side: "offense", format: "dec2", higherIsBetter: true, description: "Average runs scored.", compute: (l) => avg(l, (x) => x.box.runs) },
    { key: "avg", label: "Team batting average", side: "offense", format: "avg3", higherIsBetter: true, description: "Hits per at-bat.", compute: (l) => ratio(l, (x) => x.box.hits, (x) => x.box.ab) },
    { key: "obp", label: "On-base % (approx.)", side: "offense", format: "avg3", higherIsBetter: true, description: "(H + BB) / (AB + BB).", compute: (l) => ratio(l, (x) => x.box.hits + x.box.bb, (x) => x.box.ab + x.box.bb) },
    { key: "hrpg", label: "Home runs / game", side: "offense", format: "dec2", higherIsBetter: true, description: "Average home runs.", compute: (l) => avg(l, (x) => x.box.hr) },
    { key: "kpg", label: "Batting strikeouts / game", side: "offense", format: "dec1", higherIsBetter: false, description: "Average strikeouts by the lineup.", compute: (l) => avg(l, (x) => x.box.so) },
    { key: "rapg", label: "Runs allowed / game", side: "defense", format: "dec2", higherIsBetter: false, description: "Average runs allowed.", compute: (l) => avg(l, (x) => x.allowed.runs) },
    { key: "era", label: "Team ERA", side: "defense", format: "dec2", higherIsBetter: false, description: "Earned runs allowed per nine innings.", compute: (l) => avg(l, (x) => x.allowed.er) },
    { key: "whip", label: "Team WHIP", side: "defense", format: "dec2", higherIsBetter: false, description: "Walks plus hits per inning pitched.", compute: (l) => mul(ratio(l, (x) => x.allowed.hits + x.allowed.bb, () => 9), 1) },
    { key: "staffK", label: "Pitching strikeouts / game", side: "defense", format: "dec1", higherIsBetter: true, description: "Average strikeouts by the pitching staff.", compute: (l) => avg(l, (x) => x.allowed.so) },
    { key: "hrAllowed", label: "Home runs allowed / game", side: "defense", format: "dec2", higherIsBetter: false, description: "Average home runs allowed.", compute: (l) => avg(l, (x) => x.allowed.hr) },
  ],
  marginSd: 4.2,
  lowScoring: true,
  allowDraw: false,
};

// ---------- NHL ----------
const nhl: SportDef = {
  id: "nhl",
  name: "NHL",
  league: "Hockey",
  scoreUnit: "goals",
  playingTimeLabel: "Time on ice (min)",
  playingTimeShort: "TOI",
  usageLabel: null,
  positionGroups: [
    { id: "F", label: "Forward" },
    { id: "D", label: "Defense" },
    { id: "G", label: "Goaltender" },
  ],
  stats: [
    { key: "goals", label: "Goals", short: "G", format: "dec2", groups: ["F", "D"], forecastable: true, dist: "count", dim: "goals" },
    { key: "assists", label: "Assists", short: "A", format: "dec2", groups: ["F", "D"], forecastable: true, dist: "count", dim: "goals" },
    { key: "points", label: "Points", short: "PTS", format: "dec2", groups: ["F", "D"], forecastable: true, dist: "count", dim: "goals" },
    { key: "sog", label: "Shots on goal", short: "SOG", format: "dec1", groups: ["F", "D"], forecastable: true, dist: "count", dim: "shots" },
    { key: "blk", label: "Blocked shots", short: "BLK", format: "dec1", groups: ["F", "D"], forecastable: true, dist: "count", dim: "shotsFor" },
    { key: "saves", label: "Saves", short: "SV", format: "dec1", groups: ["G"], forecastable: true, dist: "count", dim: "shotsFor" },
    { key: "ga", label: "Goals against", short: "GA", format: "dec2", groups: ["G"], forecastable: true, dist: "count", dim: "goalsFor", higherIsBetter: false },
    { key: "svPct", label: "Save percentage", short: "SV%", format: "avg3", groups: ["G"], forecastable: false, dist: "continuous", ratio: { num: "saves", den: "shotsAgainst" } },
  ],
  headline: { F: ["goals", "points", "sog"], D: ["points", "sog", "blk"], G: ["saves", "ga", "svPct"] },
  dims: [
    { id: "goals", label: "Goals allowed", source: "allowed", key: "goals" },
    { id: "shots", label: "Shots allowed", source: "allowed", key: "shots" },
    { id: "shotsFor", label: "Opponent shots generated", source: "box", key: "shots" },
    { id: "goalsFor", label: "Opponent goals scored", source: "box", key: "goals" },
  ],
  teamMetrics: [
    { key: "gf", label: "Goals for / game", side: "offense", format: "dec2", higherIsBetter: true, description: "Average goals scored.", compute: (l) => avg(l, (x) => x.box.goals) },
    { key: "sf", label: "Shots for / game", side: "offense", format: "dec1", higherIsBetter: true, description: "Average shots on goal.", compute: (l) => avg(l, (x) => x.box.shots) },
    { key: "pp", label: "Power-play %", side: "offense", format: "pct", higherIsBetter: true, description: "Power-play goals per opportunity.", compute: (l) => ratio(l, (x) => x.box.ppGoals, (x) => x.box.ppOpp) },
    { key: "fo", label: "Faceoff win %", side: "offense", format: "pct", higherIsBetter: true, description: "Faceoffs won.", compute: (l) => ratio(l, (x) => x.box.foWon, (x) => x.box.foWon + x.allowed.foWon) },
    { key: "shPct", label: "Shooting %", side: "offense", format: "pct", higherIsBetter: true, description: "Goals per shot on goal.", compute: (l) => ratio(l, (x) => x.box.goals, (x) => x.box.shots) },
    { key: "ga", label: "Goals against / game", side: "defense", format: "dec2", higherIsBetter: false, description: "Average goals allowed.", compute: (l) => avg(l, (x) => x.allowed.goals) },
    { key: "sa", label: "Shots against / game", side: "defense", format: "dec1", higherIsBetter: false, description: "Average shots allowed.", compute: (l) => avg(l, (x) => x.allowed.shots) },
    { key: "pk", label: "Penalty kill %", side: "defense", format: "pct", higherIsBetter: true, description: "Opponent power plays killed.", compute: (l) => sub1(ratio(l, (x) => x.allowed.ppGoals, (x) => x.allowed.ppOpp)) },
    { key: "svPct", label: "Team save %", side: "defense", format: "avg3", higherIsBetter: true, description: "Saves per shot against.", compute: (l) => sub1(ratio(l, (x) => x.allowed.goals, (x) => x.allowed.shots)) },
  ],
  marginSd: 2.3,
  lowScoring: true,
  allowDraw: false,
};

// ---------- Soccer ----------
const soccer: SportDef = {
  id: "soccer",
  name: "Soccer",
  league: "Football (soccer)",
  scoreUnit: "goals",
  playingTimeLabel: "Minutes",
  playingTimeShort: "MIN",
  usageLabel: null,
  positionGroups: [
    { id: "FW", label: "Forward" },
    { id: "MF", label: "Midfielder" },
    { id: "DF", label: "Defender" },
    { id: "GK", label: "Goalkeeper" },
  ],
  stats: [
    { key: "goals", label: "Goals", short: "G", format: "dec2", groups: ["FW", "MF", "DF"], forecastable: true, dist: "count", dim: "goals" },
    { key: "assists", label: "Assists", short: "A", format: "dec2", groups: ["FW", "MF", "DF"], forecastable: true, dist: "count", dim: "goals" },
    { key: "shots", label: "Shots", short: "SH", format: "dec1", groups: ["FW", "MF", "DF"], forecastable: true, dist: "count", dim: "shots" },
    { key: "sot", label: "Shots on target", short: "SOT", format: "dec1", groups: ["FW", "MF", "DF"], forecastable: true, dist: "count", dim: "sot" },
    { key: "xg", label: "Expected goals", short: "xG", format: "dec2", groups: ["FW", "MF", "DF"], forecastable: false, dist: "continuous" },
    { key: "passPct", label: "Pass accuracy", short: "PASS%", format: "pct", groups: ["FW", "MF", "DF", "GK"], forecastable: false, dist: "continuous", ratio: { num: "passCmp", den: "passAtt" } },
    { key: "passAtt", label: "Passes attempted", short: "PASSES", format: "dec1", groups: ["MF", "DF"], forecastable: true, dist: "count", dim: "possession" },
    { key: "tackles", label: "Tackles", short: "TKL", format: "dec1", groups: ["MF", "DF"], forecastable: true, dist: "count", dim: "possessionFor" },
    { key: "saves", label: "Saves", short: "SV", format: "dec1", groups: ["GK"], forecastable: true, dist: "count", dim: "sotFor" },
  ],
  headline: { FW: ["goals", "shots", "xg"], MF: ["assists", "passAtt", "tackles"], DF: ["tackles", "passAtt", "passPct"], GK: ["saves", "passPct"] },
  dims: [
    { id: "goals", label: "Goals allowed", source: "allowed", key: "goals" },
    { id: "shots", label: "Shots allowed", source: "allowed", key: "shots" },
    { id: "sot", label: "Shots on target allowed", source: "allowed", key: "sot" },
    { id: "possession", label: "Possession conceded", source: "allowed", key: "possession" },
    { id: "possessionFor", label: "Opponent possession", source: "box", key: "possession" },
    { id: "sotFor", label: "Opponent shots on target", source: "box", key: "sot" },
  ],
  teamMetrics: [
    { key: "gf", label: "Goals for / match", side: "offense", format: "dec2", higherIsBetter: true, description: "Average goals scored.", compute: (l) => avg(l, (x) => x.box.goals) },
    { key: "xgf", label: "xG for / match", side: "offense", format: "dec2", higherIsBetter: true, description: "Expected goals created.", compute: (l) => avg(l, (x) => x.box.xg) },
    { key: "shf", label: "Shots / match", side: "offense", format: "dec1", higherIsBetter: true, description: "Average shots.", compute: (l) => avg(l, (x) => x.box.shots) },
    { key: "sotf", label: "Shots on target / match", side: "offense", format: "dec1", higherIsBetter: true, description: "Average shots on target.", compute: (l) => avg(l, (x) => x.box.sot) },
    { key: "poss", label: "Possession %", side: "offense", format: "dec1", higherIsBetter: true, description: "Average share of possession.", compute: (l) => avg(l, (x) => x.box.possession) },
    { key: "passAcc", label: "Pass accuracy", side: "offense", format: "pct", higherIsBetter: true, description: "Completed passes per attempt.", compute: (l) => ratio(l, (x) => x.box.passCmp, (x) => x.box.passAtt) },
    { key: "ga", label: "Goals against / match", side: "defense", format: "dec2", higherIsBetter: false, description: "Average goals conceded.", compute: (l) => avg(l, (x) => x.allowed.goals) },
    { key: "xga", label: "xG against / match", side: "defense", format: "dec2", higherIsBetter: false, description: "Expected goals conceded.", compute: (l) => avg(l, (x) => x.allowed.xg) },
    { key: "sha", label: "Shots against / match", side: "defense", format: "dec1", higherIsBetter: false, description: "Average shots conceded.", compute: (l) => avg(l, (x) => x.allowed.shots) },
    { key: "cs", label: "Clean sheet %", side: "defense", format: "pct", higherIsBetter: true, description: "Matches without conceding.", compute: (l) => avg(l, (x) => (x.allowed.goals === 0 ? 1 : 0)) },
    { key: "tkl", label: "Tackles / match", side: "defense", format: "dec1", higherIsBetter: true, description: "Average tackles made.", compute: (l) => avg(l, (x) => x.box.tackles) },
  ],
  marginSd: 1.7,
  lowScoring: true,
  allowDraw: true,
};

function mul(v: number | null, k: number) {
  return v == null ? null : v * k;
}
function sub1(v: number | null) {
  return v == null ? null : 1 - v;
}

export const SPORTS: Record<SportId, SportDef> = { nba, nfl, mlb, nhl, soccer };

/** Lets a data provider relabel playing-time measures it defines differently (e.g. NFL opportunities vs snap share). */
export function setSportLabels(sport: SportId, labels: Partial<Pick<SportDef, "playingTimeLabel" | "playingTimeShort" | "usageLabel">>) {
  Object.assign(SPORTS[sport], labels);
}

export function getSport(id: string | undefined | null): SportDef | null {
  if (!id) return null;
  return (SPORTS as Record<string, SportDef>)[id.toLowerCase()] ?? null;
}

export function statDef(sport: SportId, key: string): StatDef | undefined {
  return SPORTS[sport].stats.find((s) => s.key === key);
}

export function statsForGroup(sport: SportId, group: string): StatDef[] {
  return SPORTS[sport].stats.filter((s) => s.groups.includes(group));
}

export function formatStat(v: number | null | undefined, format: StatFormat): string {
  if (v == null || Number.isNaN(v)) return "—";
  switch (format) {
    case "int":
      return Math.round(v).toString();
    case "dec1":
      return v.toFixed(1);
    case "dec2":
      return v.toFixed(2);
    case "pct":
      return (v * 100).toFixed(1) + "%";
    case "avg3":
      return v.toFixed(3).replace(/^0/, "");
  }
}
