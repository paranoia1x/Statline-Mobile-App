/**
 * Converts an ESPN game summary into a compact, sport-normalised box score
 * using the stat keys defined in src/lib/sports.ts. Anything ESPN does not
 * provide is simply absent (the UI shows it as missing data).
 */
import type { SportId } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Box = Record<string, number>;

export interface CompactPlayerLine {
  athleteId: string;
  teamEspnId: string;
  starter: boolean;
  minutes: number;
  stats: Record<string, number>;
  /** Pitchers: true if this pitcher started the game. */
  startingPitcher?: boolean;
}

/** Closing betting market from ESPN's pick center: home spread, game total and moneylines. */
export interface GameOdds {
  spread: number | null;
  total: number | null;
  homeMl: number | null;
  awayMl: number | null;
}

/** v2 adds closing odds and extra NFL fantasy stats (fumbles lost, kicking, return/defensive TDs). */
export const COMPACT_GAME_VERSION = 2;

export interface CompactGame {
  v: number;
  eventId: string;
  sport: SportId;
  home: { teamEspnId: string; score: number; box: Box };
  away: { teamEspnId: string; score: number; box: Box };
  players: CompactPlayerLine[];
  odds?: GameOdds | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "" || v === "--") return null;
  const n = Number(String(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
/** "40-84", "24/29", "2-6" -> [40, 84] */
const pair = (v: unknown): [number, number] | null => {
  const m = String(v ?? "").match(/^\s*(-?\d+)\s*[-/]\s*(-?\d+)\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const clock = (v: unknown): number | null => {
  const m = String(v ?? "").match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : num(v);
};
const set = (o: Record<string, number>, k: string, v: number | null) => {
  if (v != null && Number.isFinite(v)) o[k] = v;
};

function teamStats(t: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of t?.statistics ?? []) {
    if (Array.isArray(s.stats)) for (const x of s.stats) out[`${s.name}.${x.name}`] = x.displayValue ?? x.value;
    else out[s.name] = s.displayValue ?? s.value;
  }
  return out;
}

/** Closing line from the summary's pick center (first provider). */
export function parseOdds(j: any): GameOdds | null {
  const pc = (j?.pickcenter ?? [])[0];
  if (!pc) return null;
  const n = (v: unknown) => {
    const x = typeof v === "string" ? Number(v.replace(/^[ou]/i, "")) : Number(v);
    return v == null || v === "" || !Number.isFinite(x) ? null : x;
  };
  const o = {
    spread: n(pc.spread),
    total: n(pc.overUnder),
    homeMl: n(pc.homeTeamOdds?.moneyLine ?? pc.moneyline?.home?.close?.odds),
    awayMl: n(pc.awayTeamOdds?.moneyLine ?? pc.moneyline?.away?.close?.odds),
  };
  return o.spread == null && o.total == null && o.homeMl == null ? null : o;
}

export function parseSummary(sport: SportId, eventId: string, j: any): CompactGame | null {
  const comp = j?.header?.competitions?.[0];
  if (!comp?.status?.type?.completed) return null;
  const sides: Record<string, { teamEspnId: string; score: number; box: Box }> = {};
  for (const c of comp.competitors ?? []) sides[c.homeAway] = { teamEspnId: String(c.team?.id ?? c.id), score: num(c.score) ?? 0, box: {} };
  if (!sides.home || !sides.away) return null;
  const byTeam = (id: string) => (sides.home.teamEspnId === id ? sides.home : sides.away.teamEspnId === id ? sides.away : null);
  const players: CompactPlayerLine[] = [];

  // ---------- team box ----------
  for (const t of j?.boxscore?.teams ?? []) {
    const side = byTeam(String(t.team?.id));
    if (!side) continue;
    const s = teamStats(t);
    const b = side.box;
    switch (sport) {
      case "nba": {
        const fg = pair(s["fieldGoalsMade-fieldGoalsAttempted"]);
        const tp = pair(s["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);
        const ft = pair(s["freeThrowsMade-freeThrowsAttempted"]);
        if (fg) (b.fgm = fg[0]), (b.fga = fg[1]);
        if (tp) (b.fg3m = tp[0]), (b.fg3a = tp[1]);
        if (ft) (b.ftm = ft[0]), (b.fta = ft[1]);
        set(b, "reb", num(s.totalRebounds));
        set(b, "oreb", num(s.offensiveRebounds));
        set(b, "ast", num(s.assists));
        set(b, "tov", num(s.totalTurnovers ?? s.turnovers));
        set(b, "stl", num(s.steals));
        set(b, "blk", num(s.blocks));
        if (b.fga != null && b.fta != null && b.oreb != null && b.tov != null) b.poss = Math.round((b.fga + 0.44 * b.fta - b.oreb + b.tov) * 10) / 10;
        break;
      }
      case "nfl": {
        const ca = pair(s.completionAttempts);
        if (ca) (b.cmp = ca[0]), (b.passAtt = ca[1]);
        set(b, "passYds", num(s.netPassingYards));
        set(b, "rushYds", num(s.rushingYards));
        set(b, "rushAtt", num(s.rushingAttempts));
        set(b, "plays", num(s.totalOffensivePlays));
        set(b, "turnovers", num(s.turnovers));
        const sk = pair(s.sacksYardsLost);
        if (sk) b.sacksTaken = sk[0];
        const rz = pair(s.redZoneAttempts);
        if (rz) (b.rzTd = rz[0]), (b.rzTrips = rz[1]);
        const td = pair(s.thirdDownEff);
        if (td) (b.thirdConv = td[0]), (b.thirdAtt = td[1]);
        const top = clock(s.possessionTime);
        if (top != null && b.plays) b.secPerPlay = Math.round(((top * 60) / b.plays) * 10) / 10;
        set(b, "fumblesLost", num(s.fumblesLost));
        set(b, "defTd", num(s.defensiveTouchdowns));
        break;
      }
      case "mlb": {
        set(b, "ab", num(s["batting.atBats"]));
        set(b, "hits", num(s["batting.hits"]));
        set(b, "hr", num(s["batting.homeRuns"]));
        set(b, "bb", num(s["batting.walks"]));
        set(b, "so", num(s["batting.strikeouts"]));
        break;
      }
      case "nhl": {
        set(b, "shots", num(s.shotsTotal));
        set(b, "ppGoals", num(s.powerPlayGoals));
        set(b, "ppOpp", num(s.powerPlayOpportunities));
        set(b, "foWon", num(s.faceoffsWon));
        set(b, "hits", num(s.hits));
        set(b, "blocks", num(s.blockedShots));
        break;
      }
      case "soccer": {
        set(b, "shots", num(s.totalShots));
        set(b, "sot", num(s.shotsOnTarget));
        set(b, "possession", num(s.possessionPct));
        set(b, "passCmp", num(s.accuratePasses));
        set(b, "passAtt", num(s.totalPasses));
        set(b, "tackles", num(s.totalTackles));
        set(b, "corners", num(s.wonCorners));
        break;
      }
    }
  }
  for (const side of [sides.home, sides.away]) side.box[sport === "mlb" ? "runs" : sport === "nhl" || sport === "soccer" ? "goals" : "pts"] = side.score;

  // ---------- player lines ----------
  if (sport === "soccer") {
    for (const r of j?.rosters ?? []) {
      const tid = String(r.team?.id);
      for (const p of r.roster ?? []) {
        const st: Record<string, string> = {};
        for (const x of p.stats ?? []) st[x.name] = x.displayValue ?? x.value;
        const played = p.starter || p.subbedIn;
        if (!played) continue;
        const stats: Record<string, number> = {};
        set(stats, "goals", num(st.totalGoals));
        set(stats, "assists", num(st.goalAssists));
        set(stats, "shots", num(st.totalShots));
        set(stats, "sot", num(st.shotsOnTarget));
        if ((p.position?.abbreviation ?? "").startsWith("G")) set(stats, "saves", num(st.saves));
        // ESPN does not publish exact minutes here: estimate from starts/substitutions
        const minutes = p.starter ? (p.subbedOut ? 70 : 90) : 25;
        players.push({ athleteId: String(p.athlete?.id), teamEspnId: tid, starter: !!p.starter, minutes, stats });
      }
    }
  } else {
    for (const team of j?.boxscore?.players ?? []) {
      const tid = String(team.team?.id);
      const merged = new Map<string, CompactPlayerLine>();
      const get = (a: any) => {
        const id = String(a.athlete?.id);
        if (!merged.has(id)) merged.set(id, { athleteId: id, teamEspnId: tid, starter: !!a.starter, minutes: 0, stats: {} });
        return merged.get(id)!;
      };
      for (const grp of team.statistics ?? []) {
        const keys: string[] = grp.keys ?? [];
        const isPitching = keys.includes("fullInnings.partInnings");
        (grp.athletes ?? []).forEach((a: any, idx: number) => {
          if (a.didNotPlay || !Array.isArray(a.stats) || !a.stats.length) return;
          const v: Record<string, string> = {};
          keys.forEach((k, i) => (v[k] = a.stats[i]));
          const line = get(a);
          const s = line.stats;
          switch (sport) {
            case "nba": {
              const fg = pair(v["fieldGoalsMade-fieldGoalsAttempted"]);
              const tp = pair(v["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);
              const ft = pair(v["freeThrowsMade-freeThrowsAttempted"]);
              line.minutes = num(v.minutes) ?? 0;
              if (!line.minutes) return void merged.delete(line.athleteId);
              set(s, "pts", num(v.points));
              if (fg) (s.fgm = fg[0]), (s.fga = fg[1]);
              if (tp) (s.fg3m = tp[0]), (s.fg3a = tp[1]);
              if (ft) (s.ftm = ft[0]), (s.fta = ft[1]);
              set(s, "reb", num(v.rebounds));
              set(s, "ast", num(v.assists));
              set(s, "tov", num(v.turnovers));
              set(s, "stl", num(v.steals));
              set(s, "blk", num(v.blocks));
              if (s.pts != null && s.reb != null && s.ast != null) s.pra = s.pts + s.reb + s.ast;
              break;
            }
            case "nfl": {
              if (grp.name === "passing") {
                const ca = pair(v["completions/passingAttempts"]);
                if (ca) (s.cmp = ca[0]), (s.att = ca[1]);
                set(s, "passYds", num(v.passingYards));
                set(s, "passTd", num(v.passingTouchdowns));
                set(s, "int", num(v.interceptions));
              } else if (grp.name === "rushing") {
                set(s, "carries", num(v.rushingAttempts));
                set(s, "rushYds", num(v.rushingYards));
                set(s, "rushTd", num(v.rushingTouchdowns));
              } else if (grp.name === "receiving") {
                set(s, "rec", num(v.receptions));
                set(s, "recYds", num(v.receivingYards));
                set(s, "recTd", num(v.receivingTouchdowns));
                set(s, "targets", num(v.receivingTargets));
              } else if (grp.name === "fumbles") {
                set(s, "fumLost", num(v.fumblesLost));
              } else if (grp.name === "kicking") {
                const fg = pair(v["fieldGoalsMade/fieldGoalAttempts"]);
                const xp = pair(v["extraPointsMade/extraPointAttempts"]);
                if (fg) (s.fgm = fg[0]), (s.fga = fg[1]);
                if (xp) (s.xpm = xp[0]), (s.xpa = xp[1]);
                set(s, "fgLong", num(v.longFieldGoalMade));
                set(s, "kickPts", num(v.totalKickingPoints));
              } else if (grp.name === "kickReturns" || grp.name === "puntReturns") {
                const td = num(v.kickReturnTouchdowns ?? v.puntReturnTouchdowns);
                if (td) s.retTd = (s.retTd ?? 0) + td;
              }
              break;
            }
            case "mlb": {
              if (isPitching) {
                const ip = String(v["fullInnings.partInnings"] ?? "");
                const m = ip.match(/^(\d+)(?:\.(\d))?$/);
                const outs = m ? Number(m[1]) * 3 + Number(m[2] ?? 0) : null;
                set(s, "outs", outs);
                set(s, "k", num(v.strikeouts));
                set(s, "hitsAllowed", num(v.hits));
                set(s, "bbAllowed", num(v.walks));
                set(s, "er", num(v.earnedRuns));
                line.minutes = outs != null ? Math.round((outs / 3) * 10) / 10 : 0;
                line.startingPitcher = idx === 0;
              } else if (keys.includes("atBats")) {
                set(s, "ab", num(v.atBats));
                set(s, "runs", num(v.runs));
                set(s, "hits", num(v.hits));
                set(s, "rbi", num(v.RBIs));
                set(s, "hr", num(v.homeRuns));
                set(s, "bb", num(v.walks));
                set(s, "so", num(v.strikeouts));
                line.minutes = (s.ab ?? 0) + (s.bb ?? 0);
                if (!line.minutes) return void merged.delete(line.athleteId);
              }
              break;
            }
            case "nhl": {
              line.minutes = clock(v.timeOnIce) ?? 0;
              if (grp.name === "goalies") {
                set(s, "saves", num(v.saves));
                set(s, "shotsAgainst", num(v.shotsAgainst));
                set(s, "ga", num(v.goalsAgainst));
              } else {
                set(s, "goals", num(v.goals));
                set(s, "assists", num(v.assists));
                set(s, "sog", num(v.shotsTotal));
                set(s, "blk", num(v.blockedShots));
                if (s.goals != null && s.assists != null) s.points = s.goals + s.assists;
              }
              if (!line.minutes) return void merged.delete(line.athleteId);
              break;
            }
          }
        });
      }
      for (const line of merged.values()) {
        if (sport === "nfl") {
          const s = line.stats;
          if (s.rushTd != null || s.recTd != null) s.td = (s.rushTd ?? 0) + (s.recTd ?? 0);
          line.minutes = (s.att ?? 0) + (s.carries ?? 0) + (s.targets ?? 0) + (s.fga ?? 0) + (s.xpa ?? 0);
          const side = byTeam(tid);
          const opps = side ? (side.box.passAtt ?? 0) + (side.box.rushAtt ?? 0) : 0;
          if (opps && s.att == null) s.usage = Math.round((((s.carries ?? 0) + (s.targets ?? 0)) / opps) * 1000) / 10;
          if (!line.minutes) continue;
        }
        players.push(line);
      }
    }
  }

  // MLB: earned runs scored by a team = earned runs charged to the opposing pitchers
  if (sport === "mlb") {
    for (const side of [sides.home, sides.away]) {
      const opp = side === sides.home ? sides.away : sides.home;
      side.box.er = players.filter((p) => p.teamEspnId === opp.teamEspnId && p.stats.er != null).reduce((a, p) => a + p.stats.er, 0);
    }
  }
  return { v: COMPACT_GAME_VERSION, eventId, sport, home: sides.home, away: sides.away, players, odds: parseOdds(j) };
}
