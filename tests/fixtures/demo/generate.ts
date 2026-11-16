/**
 * DEMO DATA GENERATOR
 *
 * Produces a deterministic, entirely fictional sports universe (teams, players,
 * schedules, box scores and injuries) so the platform is fully explorable
 * without licensed data credentials. Every surface that shows this data is
 * labelled "Demo data". Nothing here represents real athletes or results.
 *
 * The timeline is fixed (independent of the current date) so that game and
 * player IDs are stable. The provider reveals results only for games whose
 * scheduled time has passed, which lets forecasts be graded later exactly like
 * they would be against a live feed.
 */
import { Rng, hashString } from "@/lib/rng";
import type { Game, Injury, Player, PlayerGameLog, SportId, Team, TeamGameLog } from "@/lib/types";
import { SPORT_IDS } from "@/lib/types";
import { DEMO_SEASONS, DEMO_TEAMS, FIRST_NAMES, LAST_NAMES, ROSTER_TEMPLATES, SCHEDULE } from "./catalog";

export interface InjurySpell {
  playerId: string;
  start: number; // epoch ms
  end: number;
  description: string;
}

export interface DemoUniverse {
  teams: Team[];
  players: Player[];
  games: Game[]; // all games with full results (provider masks future games)
  playerLogs: PlayerGameLog[];
  teamLogs: TeamGameLog[];
  spells: InjurySpell[];
}

type Box = Record<string, number>;
interface TeamLatent {
  off: Record<string, number>;
  def: Record<string, number>;
  style: Record<string, number>;
  home: number;
}
interface PlayerLatent {
  a: Record<string, number>;
  roleChangeAt: number | null;
  roleMult: number;
}

const DAY = 86_400_000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function binom(rng: Rng, n: number, p: number) {
  n = Math.max(0, Math.round(n));
  p = clamp(p, 0, 1);
  if (n > 60) return clamp(Math.round(rng.normal(n * p, Math.sqrt(n * p * (1 - p)))), 0, n);
  let k = 0;
  for (let i = 0; i < n; i++) if (rng.next() < p) k++;
  return k;
}

function weightedPick(rng: Rng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

const INJURY_TYPES = [
  "Ankle sprain", "Hamstring tightness", "Knee soreness", "Illness", "Concussion protocol", "Back spasms",
  "Wrist injury", "Calf strain", "Shoulder soreness", "Groin strain", "Foot contusion", "Rest / load management",
];

// ---------------- latent ratings ----------------
const TEAM_KEYS: Record<SportId, { off: string[]; def: string[] }> = {
  nba: { off: ["pace", "shoot", "three", "reb", "ast", "tov"], def: ["shoot", "three", "reb", "ast", "forceTov"] },
  nfl: { off: ["pass", "run", "scoring", "protect", "third", "explosive"], def: ["pass", "run", "scoring", "pressure", "takeaway", "third"] },
  mlb: { off: ["contact", "power", "discipline"], def: ["pitching", "power", "strikeout", "control"] },
  nhl: { off: ["shots", "finish", "pp", "faceoff"], def: ["shots", "goalie", "pk"] },
  soccer: { off: ["attack", "possession", "passing", "finishing"], def: ["defense", "press"] },
};

function makeTeamLatent(sport: SportId, rng: Rng): TeamLatent {
  const off: Record<string, number> = {};
  const def: Record<string, number> = {};
  for (const k of TEAM_KEYS[sport].off) off[k] = clamp(rng.normal(1, 0.07), 0.82, 1.18);
  for (const k of TEAM_KEYS[sport].def) def[k] = clamp(rng.normal(1, 0.07), 0.82, 1.18);
  const style: Record<string, number> = {};
  if (sport === "nfl") {
    style.passRate = rng.range(0.52, 0.64);
    style.tempo = rng.range(26, 31);
    style.playAction = rng.range(0.14, 0.32);
  }
  return { off, def, style, home: rng.range(1.01, 1.045) };
}

function playerAttrs(sport: SportId, pos: string, group: string, role: string, idx: number, rng: Rng): Record<string, number> {
  const star = role === "starter" && rng.next() < 0.3 ? 1.25 : 1;
  switch (sport) {
    case "nba": {
      const starter = role === "starter";
      const min = starter ? rng.range(29, 36) : rng.range(17, 25);
      const big = group === "C" ? 1 : group === "F" ? 0.6 : 0.2;
      return {
        min,
        ptsShare: (starter ? rng.range(0.11, 0.19) : rng.range(0.06, 0.1)) * star,
        rebShare: (0.06 + big * rng.range(0.07, 0.12)) * (starter ? 1 : 0.65),
        astShare: (group === "G" ? rng.range(0.14, 0.27) : rng.range(0.05, 0.12)) * (starter ? 1 : 0.6) * (pos === "PG" ? 1.2 : 1),
        threeShare: (group === "C" ? rng.range(0.0, 0.06) : rng.range(0.1, 0.2)) * (starter ? 1 : 0.6),
        fgPct: group === "C" ? rng.range(0.52, 0.62) : rng.range(0.42, 0.5),
        ftPct: rng.range(0.68, 0.9),
        stl: rng.range(0.5, 1.6),
        blk: group === "C" ? rng.range(0.9, 2.4) : rng.range(0.15, 0.7),
        tov: rng.range(1, 3.2) * (group === "G" ? 1.1 : 0.85) * star,
        usg: (starter ? rng.range(19, 27) : rng.range(14, 19)) * (star > 1 ? 1.15 : 1),
      };
    }
    case "nfl": {
      if (group === "QB") return { cmpRate: rng.range(0.6, 0.7), ypa: rng.range(6.6, 8.2), rushYpg: rng.range(8, 38), tdRate: rng.range(0.9, 1.15), intRate: rng.range(0.018, 0.03), snap: 99 };
      if (group === "RB") return { carryShare: rng.range(0.52, 0.72), ypc: rng.range(3.9, 5.0), tgtShare: rng.range(0.07, 0.13), catch: rng.range(0.72, 0.82), ypr: rng.range(6.5, 9.0), snap: rng.range(58, 78), tdWeight: 1.3 };
      if (group === "TE") return { tgtShare: rng.range(0.12, 0.2), catch: rng.range(0.66, 0.75), ypr: rng.range(9.5, 12), snap: rng.range(70, 88), tdWeight: 1.1 };
      const wr1 = idx === 2;
      return {
        tgtShare: (wr1 ? rng.range(0.22, 0.29) : idx === 3 ? rng.range(0.15, 0.21) : rng.range(0.09, 0.14)) * (star > 1 ? 1.08 : 1),
        catch: rng.range(0.6, 0.7),
        ypr: rng.range(11, 15.5),
        snap: wr1 ? rng.range(85, 96) : idx === 3 ? rng.range(75, 90) : rng.range(45, 65),
        tdWeight: 1,
      };
    }
    case "mlb": {
      if (group === "SP") return { outs: rng.range(15.5, 19.5), k9: rng.range(7.4, 11.2) * (star > 1 ? 1.08 : 1), era: rng.range(2.8, 4.9), h9: rng.range(7, 9.4), bb9: rng.range(2.2, 3.6) };
      return { avg: rng.range(0.235, 0.305) * (star > 1 ? 1.04 : 1), hrRate: rng.range(0.018, 0.058), kRate: rng.range(0.17, 0.29), bbRate: rng.range(0.06, 0.13), pa: rng.range(4.0, 4.6), xbh: rng.range(0.25, 0.4) };
    }
    case "nhl": {
      if (group === "G") return { svBase: rng.range(0.898, 0.922), toi: 60 };
      const fwd = group === "F";
      return {
        goalW: fwd ? rng.range(0.6, 1.5) * star : rng.range(0.15, 0.35),
        astW: fwd ? rng.range(0.7, 1.4) * star : rng.range(0.5, 0.9),
        shotShare: fwd ? rng.range(0.08, 0.13) * star : rng.range(0.05, 0.08),
        blk: fwd ? rng.range(0.3, 0.8) : rng.range(1.2, 2.3),
        toi: fwd ? (role === "starter" ? rng.range(17, 21) : rng.range(12, 15)) : rng.range(20, 24.5),
      };
    }
    case "soccer": {
      const g = group;
      return {
        goalW: g === "FW" ? rng.range(1.4, 2.6) * star : g === "MF" ? rng.range(0.4, 1.0) : g === "DF" ? rng.range(0.1, 0.3) : 0,
        astW: g === "FW" ? rng.range(0.7, 1.3) : g === "MF" ? rng.range(1.0, 1.8) * star : g === "DF" ? rng.range(0.25, 0.6) : 0.02,
        shotShare: g === "FW" ? rng.range(0.16, 0.24) * star : g === "MF" ? rng.range(0.08, 0.13) : g === "DF" ? rng.range(0.03, 0.06) : 0,
        passShare: g === "MF" ? rng.range(0.12, 0.17) : g === "DF" ? rng.range(0.1, 0.14) : g === "GK" ? rng.range(0.05, 0.07) : rng.range(0.05, 0.08),
        passAcc: g === "DF" ? rng.range(0.84, 0.91) : g === "MF" ? rng.range(0.82, 0.9) : g === "GK" ? rng.range(0.7, 0.8) : rng.range(0.72, 0.8),
        tackleShare: g === "DF" ? rng.range(0.13, 0.18) : g === "MF" ? rng.range(0.1, 0.16) : g === "GK" ? 0 : rng.range(0.03, 0.06),
        min: role === "starter" ? rng.range(78, 88) : rng.range(45, 65),
      };
    }
  }
}

// ---------------- game simulation (team level) ----------------
function simTeamBoxes(sport: SportId, h: TeamLatent, a: TeamLatent, rng: Rng): [Box, Box] {
  const one = (t: TeamLatent, o: TeamLatent, isHome: boolean): Box => {
    const ha = isHome ? t.home : 1 / t.home;
    switch (sport) {
      case "nba": {
        const poss = Math.round(rng.normal(99 * (t.off.pace + o.off.pace) / 2, 3));
        const fga = Math.round(poss * 0.89 + rng.normal(0, 2.5));
        const fg3a = Math.round(fga * 0.4 * t.off.three + rng.normal(0, 2));
        const fg3m = binom(rng, fg3a, 0.36 * Math.sqrt(t.off.three * o.def.three) * ha);
        const fg2a = fga - fg3a;
        const fg2m = binom(rng, fg2a, 0.535 * t.off.shoot * Math.sqrt(o.def.shoot) * ha);
        const fta = Math.round(rng.normal(22, 4));
        const ftm = binom(rng, fta, 0.78);
        const fgm = fg2m + fg3m;
        return {
          poss, fga, fgm, fg3a, fg3m, fta, ftm,
          pts: fg2m * 2 + fg3m * 3 + ftm,
          reb: Math.round(rng.normal(44 * t.off.reb * o.def.reb, 4)),
          ast: Math.round(fgm * 0.6 * Math.sqrt(t.off.ast * o.def.ast) + rng.normal(0, 2)),
          tov: rng.poisson(13.8 * t.off.tov * o.def.forceTov),
        };
      }
      case "nfl": {
        const plays = Math.round(rng.normal(62 * (29 / t.style.tempo), 4));
        const dropbacks = Math.round(plays * t.style.passRate);
        const sacksTaken = rng.poisson(2.4 * o.def.pressure / t.off.protect);
        const passAtt = Math.max(15, dropbacks - sacksTaken);
        const cmp = binom(rng, passAtt, 0.645 * Math.sqrt(t.off.pass * o.def.pass));
        const passYds = Math.round(cmp * rng.normal(11.1 * t.off.pass * o.def.pass * ha, 1.1));
        const rushAtt = Math.max(12, plays - dropbacks);
        const rushYds = Math.round(rushAtt * rng.normal(4.35 * t.off.run * o.def.run * ha, 0.55));
        const rzTrips = rng.poisson(3.3 * t.off.scoring * o.def.scoring * ha);
        const rzTd = binom(rng, rzTrips, 0.57 * Math.sqrt(t.off.scoring * o.def.scoring));
        const longTd = rng.poisson(0.55 * t.off.explosive);
        const fg = rng.poisson(1.5);
        const thirdAtt = Math.round(rng.normal(13, 2));
        return {
          plays, passAtt, cmp, passYds, rushAtt, rushYds, sacksTaken,
          pressuresAllowed: Math.round(dropbacks * 0.32 * o.def.pressure / t.off.protect + rng.normal(0, 2)),
          turnovers: rng.poisson(1.3 * o.def.takeaway),
          rzTrips, rzTd, tds: rzTd + longTd,
          pts: (rzTd + longTd) * 7 + fg * 3,
          thirdAtt,
          thirdConv: binom(rng, thirdAtt, 0.4 * t.off.third * o.def.third),
          playAction: Math.round(passAtt * t.style.playAction),
          explosive: rng.poisson(6 * t.off.explosive * Math.sqrt(o.def.pass * o.def.run)),
          secPerPlay: r1(rng.normal(t.style.tempo, 0.8)),
        };
      }
      case "mlb": {
        const ab = Math.round(rng.normal(33.5, 2));
        const hits = binom(rng, ab, 0.248 * t.off.contact * o.def.pitching * ha);
        const hr = Math.min(hits, rng.poisson(1.15 * t.off.power * o.def.power));
        const bb = rng.poisson(3.2 * t.off.discipline / o.def.control);
        const so = binom(rng, ab - hits, 0.3 * o.def.strikeout / t.off.contact);
        const runs = Math.max(0, Math.round(rng.normal(-0.9 + hits * 0.42 + hr * 0.9 + bb * 0.3, 1.2)));
        return { ab, hits, hr, bb, so, runs, er: Math.round(runs * 0.92) };
      }
      case "nhl": {
        const shots = Math.round(rng.normal(30 * t.off.shots * o.def.shots * ha, 4));
        const goals = binom(rng, shots, 0.098 * t.off.finish * o.def.goalie);
        const ppOpp = rng.poisson(3);
        const ppGoals = Math.min(goals, binom(rng, ppOpp, 0.2 * t.off.pp * o.def.pk));
        return { shots, goals, ppOpp, ppGoals, foWon: Math.round(rng.normal(29 * t.off.faceoff, 3)) };
      }
      case "soccer": {
        const xg = clamp(rng.normal(1.38 * t.off.attack * o.def.defense * ha, 0.45), 0.08, 4.5);
        const goals = rng.poisson(xg * t.off.finishing);
        const shots = Math.max(goals + 1, rng.poisson(12.3 * t.off.attack * o.def.defense));
        const sot = clamp(binom(rng, shots, 0.35), goals, shots);
        return { xg: Math.round(xg * 100) / 100, goals, shots, sot, corners: rng.poisson(5) };
      }
    }
  };
  const hb = one(h, a, true);
  const ab = one(a, h, false);
  // joint quantities
  if (sport === "nba" || sport === "nhl" || sport === "mlb" || sport === "nfl") {
    const key = sport === "nba" || sport === "nfl" ? "pts" : sport === "mlb" ? "runs" : "goals";
    if (hb[key] === ab[key]) {
      // no ties: overtime / extra innings
      if (rng.next() < 0.5 * h.home) hb[key] += sport === "nba" ? rng.int(2, 8) : sport === "nfl" ? 3 : 1;
      else ab[key] += sport === "nba" ? rng.int(2, 8) : sport === "nfl" ? 3 : 1;
    }
  }
  if (sport === "soccer") {
    const hp = clamp(rng.normal(50 + 9 * (h.off.possession - a.off.possession) * 5 + 2, 5), 28, 74);
    hb.possession = Math.round(hp);
    ab.possession = 100 - hb.possession;
    for (const [b, t] of [[hb, h], [ab, a]] as const) {
      b.passAtt = Math.round(b.possession * 9.2 + rng.normal(0, 25));
      b.passCmp = binom(rng, b.passAtt, 0.81 * t.off.passing);
    }
    hb.tackles = rng.poisson(16.5 * (ab.possession / 50) * h.def.press);
    ab.tackles = rng.poisson(16.5 * (hb.possession / 50) * a.def.press);
  }
  if (sport === "nhl") {
    const total = hb.foWon + ab.foWon;
    const norm = 58 / total;
    hb.foWon = Math.round(hb.foWon * norm);
    ab.foWon = 58 - hb.foWon;
  }
  return [hb, ab];
}

// ---------------- player distribution ----------------
function distributePlayers(
  sport: SportId,
  team: Box,
  opp: Box,
  roster: RosterEntry[],
  gameIndex: number,
  rng: Rng,
): Map<string, { minutes: number; started: boolean; stats: Record<string, number> }> {
  const out = new Map<string, { minutes: number; started: boolean; stats: Record<string, number> }>();
  const active = roster.filter((r) => r.avail > 0 && rng.next() < (r.avail >= 1 ? 1 : r.avail));

  switch (sport) {
    case "nba": {
      for (const r of active) {
        const a = r.l.a;
        const minutes = clamp(rng.normal(a.min * r.avail0(), 3.2), 4, 44);
        const f = minutes / a.min;
        let pts = Math.max(0, Math.round(team.pts * a.ptsShare * f * rng.normal(1, 0.2)));
        const fg3m = Math.min(Math.floor(pts / 3), rng.poisson(team.fg3m * a.threeShare * f));
        const ftm = Math.min(pts - fg3m * 3, rng.poisson(pts * 0.15));
        const fg2m = Math.max(0, Math.round((pts - fg3m * 3 - ftm) / 2));
        pts = fg2m * 2 + fg3m * 3 + ftm;
        const fgm = fg2m + fg3m;
        const fga = Math.max(fgm, Math.round(fgm / a.fgPct + rng.normal(0, 1.2)));
        const fg3a = Math.max(fg3m, Math.round(fg3m / 0.36 + rng.normal(0, 1)));
        const fta = Math.max(ftm, Math.round(ftm / a.ftPct + rng.normal(0, 0.6)));
        const reb = rng.poisson(team.reb * a.rebShare * f);
        const ast = rng.poisson(team.ast * a.astShare * f);
        out.set(r.p.id, {
          minutes: r1(minutes),
          started: r.p.role === "starter",
          stats: {
            pts, reb, ast, pra: pts + reb + ast, fgm, fga, fg3m, fg3a, ftm, fta,
            stl: rng.poisson(a.stl * f * (opp.tov / 14)),
            blk: rng.poisson(a.blk * f * (opp.fga / 88)),
            tov: rng.poisson(a.tov * f * (team.tov / 14)),
            usg: r1(clamp(rng.normal(a.usg, 3), 8, 40)),
          },
        });
      }
      break;
    }
    case "nfl": {
      const qb = active.find((r) => r.p.positionGroup === "QB");
      const tdTotal = team.tds;
      const passTdTotal = binom(rng, tdTotal, 0.6);
      const rushTdTotal = tdTotal - passTdTotal;
      const receivers = active.filter((r) => r.p.positionGroup !== "QB");
      const recStats = new Map<string, Record<string, number>>();
      for (const r of receivers) {
        const a = r.l.a;
        const targets = binom(rng, team.passAtt, (a.tgtShare ?? 0) * r.avail0());
        const rec = binom(rng, targets, a.catch ?? 0.65);
        const recYds = Math.max(0, Math.round(rec * rng.normal(a.ypr ?? 10, 3) * Math.sqrt(team.passYds / 230)));
        const s: Record<string, number> = { targets, rec, recYds, recTd: 0, rushTd: 0, carries: 0, rushYds: 0 };
        if (r.p.positionGroup === "RB") {
          s.carries = binom(rng, team.rushAtt, a.carryShare * r.avail0());
          s.rushYds = Math.round(s.carries * rng.normal(a.ypc * (team.rushYds / Math.max(1, team.rushAtt)) / 4.35, 0.9));
        }
        s.usage = r1(((targets + s.carries) / Math.max(1, team.passAtt + team.rushAtt)) * 100);
        recStats.set(r.p.id, s);
      }
      // allocate touchdowns
      for (let i = 0; i < passTdTotal; i++) {
        const w = receivers.map((r) => (recStats.get(r.p.id)!.rec + 0.2) * (r.l.a.tdWeight ?? 1));
        if (rng.next() < 0.78 && receivers.length) recStats.get(receivers[weightedPick(rng, w)].p.id)!.recTd++;
      }
      let qbRushTd = 0;
      for (let i = 0; i < rushTdTotal; i++) {
        const rb = receivers.find((r) => r.p.positionGroup === "RB");
        const x = rng.next();
        if (rb && x < 0.62) recStats.get(rb.p.id)!.rushTd++;
        else if (qb && x < 0.75) qbRushTd++;
      }
      for (const r of receivers) {
        const s = recStats.get(r.p.id)!;
        out.set(r.p.id, {
          minutes: r1(clamp(rng.normal(r.l.a.snap * r.avail0(), 5), 10, 100)),
          started: r.p.role === "starter",
          stats: { ...s, td: s.recTd + s.rushTd },
        });
      }
      if (qb) {
        const a = qb.l.a;
        out.set(qb.p.id, {
          minutes: 99,
          started: true,
          stats: {
            att: team.passAtt,
            cmp: team.cmp,
            passYds: team.passYds,
            passTd: Math.max(0, Math.round(passTdTotal * a.tdRate)),
            int: binom(rng, team.passAtt, a.intRate),
            rushYds: Math.round(clamp(rng.normal(a.rushYpg, 12), -5, 90)),
            rushTd: qbRushTd,
            carries: rng.poisson(a.rushYpg / 6),
          },
        });
      }
      break;
    }
    case "mlb": {
      for (const r of active) {
        const a = r.l.a;
        if (r.p.positionGroup === "SP") {
          const slot = r.p.jersey % 2 === 0 ? 0 : 2;
          if (gameIndex % 5 !== slot) continue;
          const outs = clamp(Math.round(rng.normal(a.outs * r.avail0(), 3)), 3, 27);
          const inn = outs / 27;
          const oppK = opp.so / 8.6;
          const oppH = opp.hits / 8.3;
          out.set(r.p.id, {
            minutes: r1(outs / 3),
            started: true,
            stats: {
              outs,
              k: rng.poisson(a.k9 * inn * oppK),
              hitsAllowed: rng.poisson(a.h9 * inn * oppH),
              bbAllowed: rng.poisson(a.bb9 * inn),
              er: rng.poisson(a.era * inn * (opp.runs / 4.4)),
            },
          });
          continue;
        }
        if (rng.next() < 0.06) continue; // rest day
        const pa = clamp(Math.round(rng.normal(a.pa, 0.6)), 2, 6);
        const bb = binom(rng, pa, a.bbRate * (team.bb / 3.2));
        const ab = pa - bb;
        const hits = binom(rng, ab, a.avg * (team.hits / 8.3) * 1.0);
        const hr = Math.min(hits, binom(rng, pa, a.hrRate * (team.hr / 1.15)));
        const xbh = binom(rng, hits - hr, a.xbh);
        const so = binom(rng, ab - hits, a.kRate / (1 - a.avg) * (team.so / 8.6));
        out.set(r.p.id, {
          minutes: pa,
          started: true,
          stats: {
            ab, hits, hr, bb, so,
            tb: hits + xbh + hr * 3,
            runs: Math.min(pa, rng.poisson(team.runs * 0.13 * (1 + hr * 0.8))) + 0,
            rbi: Math.min(4 * Math.max(1, hr), rng.poisson(team.runs * 0.12) + hr),
          },
        });
      }
      break;
    }
    case "nhl": {
      const skaters = active.filter((r) => r.p.positionGroup !== "G");
      const stats = new Map<string, Record<string, number>>();
      for (const r of skaters) stats.set(r.p.id, { goals: 0, assists: 0, points: 0, sog: 0, blk: 0 });
      const OTHERS = 3.2;
      for (let g = 0; g < team.goals; g++) {
        const w = [...skaters.map((r) => r.l.a.goalW), OTHERS];
        const i = weightedPick(rng, w);
        if (i < skaters.length) stats.get(skaters[i].p.id)!.goals++;
        const nA = rng.next() < 0.88 ? (rng.next() < 0.7 ? 2 : 1) : 0;
        for (let k = 0; k < nA; k++) {
          const wa = [...skaters.map((r, j) => (j === i ? 0 : r.l.a.astW)), OTHERS * 1.1];
          const j = weightedPick(rng, wa);
          if (j < skaters.length) stats.get(skaters[j].p.id)!.assists++;
        }
      }
      for (const r of skaters) {
        const s = stats.get(r.p.id)!;
        s.sog = Math.max(s.goals, rng.poisson(team.shots * r.l.a.shotShare));
        s.blk = rng.poisson(r.l.a.blk * (opp.shots / 30));
        s.points = s.goals + s.assists;
        out.set(r.p.id, { minutes: r1(clamp(rng.normal(r.l.a.toi * r.avail0(), 1.6), 6, 30)), started: r.p.role === "starter", stats: s });
      }
      const g = active.find((r) => r.p.positionGroup === "G");
      if (g && rng.next() < 0.8) {
        out.set(g.p.id, { minutes: 60, started: true, stats: { shotsAgainst: opp.shots, ga: opp.goals, saves: opp.shots - opp.goals } });
      }
      break;
    }
    case "soccer": {
      const field = active.filter((r) => r.p.positionGroup !== "GK");
      const stats = new Map<string, Record<string, number>>();
      for (const r of active) stats.set(r.p.id, { goals: 0, assists: 0, shots: 0, sot: 0, xg: 0, passAtt: 0, passCmp: 0, tackles: 0 });
      const OTHERS = 1.6;
      for (let g = 0; g < team.goals; g++) {
        const i = weightedPick(rng, [...field.map((r) => r.l.a.goalW), OTHERS]);
        if (i < field.length) stats.get(field[i].p.id)!.goals++;
        if (rng.next() < 0.72) {
          const j = weightedPick(rng, [...field.map((r, k) => (k === i ? 0 : r.l.a.astW)), OTHERS]);
          if (j < field.length) stats.get(field[j].p.id)!.assists++;
        }
      }
      for (const r of active) {
        const s = stats.get(r.p.id)!;
        const a = r.l.a;
        const minutes = clamp(Math.round(rng.normal(a.min * r.avail0(), 8)), 10, 90);
        const f = minutes / 90;
        s.shots = Math.max(s.goals, rng.poisson(team.shots * a.shotShare * f / 0.9));
        s.sot = clamp(binom(rng, s.shots, 0.38), s.goals, s.shots);
        s.xg = Math.round(team.xg * (a.shotShare / 0.55) * f * rng.normal(1, 0.25) * 100) / 100;
        if (s.xg < 0) s.xg = 0;
        s.passAtt = rng.poisson(team.passAtt * a.passShare * f);
        s.passCmp = binom(rng, s.passAtt, a.passAcc);
        s.tackles = rng.poisson(team.tackles * a.tackleShare * f);
        if (r.p.positionGroup === "GK") {
          s.saves = Math.max(0, opp.sot - opp.goals);
          s.goalsAgainst = opp.goals;
        }
        out.set(r.p.id, { minutes, started: r.p.role === "starter", stats: s });
      }
      break;
    }
  }
  return out;
}

/** Roster entry for one game: `avail` is the chance of playing, `avail0()` the playing-time multiplier. */
interface RosterEntry {
  p: Player;
  l: PlayerLatent;
  avail: number;
  avail0: () => number;
}

// ---------------- universe ----------------
let cached: DemoUniverse | null = null;

export function generateUniverse(): DemoUniverse {
  if (cached) return cached;
  const teams: Team[] = [];
  const players: Player[] = [];
  const games: Game[] = [];
  const playerLogs: PlayerGameLog[] = [];
  const teamLogs: TeamGameLog[] = [];
  const spells: InjurySpell[] = [];
  const usedNames = new Set<string>();

  const timelineStart = Date.parse(DEMO_SEASONS[0].start + "T00:00:00Z");
  const timelineEnd = Date.parse(DEMO_SEASONS[DEMO_SEASONS.length - 1].end + "T23:59:59Z");

  for (const sport of SPORT_IDS) {
    const rng = new Rng(`demo-${sport}-v1`);
    const latents = new Map<string, TeamLatent>();
    const rosters = new Map<string, { p: Player; l: PlayerLatent }[]>();

    DEMO_TEAMS[sport].forEach((seed) => {
      const id = `${sport}-${seed.abbr.toLowerCase()}`;
      teams.push({
        id, sport, city: seed.city, name: seed.name, fullName: `${seed.city} ${seed.name}`, abbreviation: seed.abbr,
        conference: seed.conference, venue: seed.venue, colors: { primary: seed.colors[0], secondary: seed.colors[1] },
      });
      latents.set(id, makeTeamLatent(sport, rng));
      const jerseys = new Set<number>();
      const roster: { p: Player; l: PlayerLatent }[] = [];
      ROSTER_TEMPLATES[sport].forEach((tpl, idx) => {
        let first = "", last = "", full = "";
        do {
          first = rng.pick(FIRST_NAMES);
          last = rng.pick(LAST_NAMES);
          full = `${first} ${last}`;
        } while (usedNames.has(full));
        usedNames.add(full);
        let jersey = 0;
        do jersey = tpl.group === "SP" ? rng.int(10, 69) : rng.int(0, 99);
        while (jerseys.has(jersey));
        jerseys.add(jersey);
        const pid = `${sport}-${slug(full)}`;
        const player: Player = {
          id: pid, sport, teamId: id, firstName: first, lastName: last, name: full,
          position: tpl.pos, positionGroup: tpl.group, jersey, age: rng.int(21, 35), role: tpl.role,
        };
        if (sport === "mlb" && tpl.group === "SP") player.jersey = idx === 5 ? (jersey % 2 === 0 ? jersey : jersey + 1) : jersey % 2 === 1 ? jersey : jersey + 1;
        const hasRoleChange = rng.next() < 0.2;
        const latent: PlayerLatent = {
          a: playerAttrs(sport, tpl.pos, tpl.group, tpl.role, idx, rng),
          roleChangeAt: hasRoleChange ? rng.range(timelineStart + 120 * DAY, timelineEnd - 60 * DAY) : null,
          roleMult: rng.next() < 0.5 ? 0.74 : 1.24,
        };
        players.push(player);
        roster.push({ p: player, l: latent });
        // injury spells over the whole timeline
        const nSpells = rng.poisson(2.2);
        for (let s = 0; s < nSpells; s++) {
          const start = rng.range(timelineStart, timelineEnd);
          const len = rng.int(4, 26) * DAY;
          spells.push({ playerId: pid, start, end: start + len, description: rng.pick(INJURY_TYPES) });
        }
      });
      rosters.set(id, roster);
    });

    const teamIds = DEMO_TEAMS[sport].map((s) => `${sport}-${s.abbr.toLowerCase()}`);
    const sched = SCHEDULE[sport];
    const gameCount = new Map<string, number>();
    const spellsByPlayer = new Map<string, InjurySpell[]>();
    for (const s of spells) if (s.playerId.startsWith(sport + "-")) {
      const arr = spellsByPlayer.get(s.playerId) ?? [];
      arr.push(s);
      spellsByPlayer.set(s.playerId, arr);
    }

    let round = 0;
    for (const season of DEMO_SEASONS) {
      const s0 = Date.parse(season.start + "T00:00:00Z") + sched.offsetDays * DAY;
      const s1 = Date.parse(season.end + "T00:00:00Z");
      for (let day = s0; day <= s1; day += sched.everyDays * DAY) {
        // circle-method round robin
        const n = teamIds.length;
        const rot = [teamIds[0], ...rotate(teamIds.slice(1), round % (n - 1))];
        for (let i = 0; i < n / 2; i++) {
          let home = rot[i];
          let away = rot[n - 1 - i];
          if ((round + i) % 2 === 1) [home, away] = [away, home];
          const when = day + sched.hourUtc * 3600_000 + sched.minuteUtc * 60_000;
          const iso = new Date(when).toISOString();
          const gid = `${sport}-${iso.slice(0, 10).replace(/-/g, "")}-${away.split("-")[1]}-${home.split("-")[1]}`;
          const grng = new Rng(hashString(gid));
          const [hb, ab] = simTeamBoxes(sport, latents.get(home)!, latents.get(away)!, grng);
          const scoreKey = sport === "nba" || sport === "nfl" ? "pts" : sport === "mlb" ? "runs" : "goals";
          const game: Game = {
            id: gid, sport, season: season.id, date: iso, homeTeamId: home, awayTeamId: away,
            venue: teams.find((t) => t.id === home)!.venue, status: "final", homeScore: hb[scoreKey], awayScore: ab[scoreKey],
          };
          games.push(game);
          for (const [tid, oid, box, allowed, isHome] of [
            [home, away, hb, ab, true],
            [away, home, ab, hb, false],
          ] as const) {
            const sf = box[scoreKey];
            const sa = allowed[scoreKey];
            teamLogs.push({
              teamId: tid, gameId: gid, sport, season: season.id, date: iso, opponentId: oid, home: isHome,
              scoreFor: sf, scoreAgainst: sa, result: sf > sa ? "W" : sf < sa ? "L" : "D", box, allowed,
            });
            const gi = gameCount.get(tid) ?? 0;
            gameCount.set(tid, gi + 1);
            const roster: RosterEntry[] = rosters.get(tid)!.map((r) => {
              const sp = (spellsByPlayer.get(r.p.id) ?? []).find((s) => when >= s.start && when <= s.end);
              let avail = 1;
              if (sp) {
                const left = (sp.end - when) / DAY;
                avail = left <= 2 ? 0.6 : left <= 5 ? 0.25 : 0;
              }
              const roleM = r.l.roleChangeAt != null && when >= r.l.roleChangeAt ? r.l.roleMult : 1;
              const minuteFactor = (avail > 0 && avail < 1 ? 0.88 : 1) * roleM;
              return { ...r, avail, avail0: () => minuteFactor };
            });
            const dist = distributePlayers(sport, box, allowed, roster, gi, grng);
            for (const [pid, d] of dist) {
              playerLogs.push({
                playerId: pid, gameId: gid, sport, season: season.id, date: iso, teamId: tid, opponentId: oid,
                home: isHome, started: d.started, minutes: d.minutes, stats: d.stats,
              });
            }
          }
        }
        round++;
      }
    }
  }

  games.sort((a, b) => a.date.localeCompare(b.date));
  cached = { teams, players, games, playerLogs, teamLogs, spells };
  return cached;
}

function rotate<T>(arr: T[], k: number): T[] {
  const n = arr.length;
  const s = ((k % n) + n) % n;
  return [...arr.slice(n - s), ...arr.slice(0, n - s)];
}

export function injuryAt(spells: InjurySpell[], playerId: string, at: number): Injury | null {
  const sp = spells.find((s) => s.playerId === playerId && at >= s.start - 0 && at <= s.end);
  if (!sp) {
    // recently returned: day-to-day for 3 days after a spell
    const recent = spells.find((s) => s.playerId === playerId && at > s.end && at - s.end < 3 * DAY);
    if (recent)
      return { playerId, status: "day-to-day", description: `${recent.description} (recently returned)`, updatedAt: new Date(recent.end).toISOString(), expectedReturn: null };
    return null;
  }
  const left = (sp.end - at) / DAY;
  const status = left <= 2 ? "questionable" : left <= 5 ? "doubtful" : "out";
  return {
    playerId,
    status,
    description: sp.description,
    updatedAt: new Date(Math.max(sp.start, at - DAY)).toISOString(),
    expectedReturn: new Date(sp.end + DAY).toISOString(),
  };
}
