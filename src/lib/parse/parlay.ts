/**
 * Bet-slip / parlay parser. Reads player props (via the pick parser) and team
 * legs — moneyline, spread, game total and draw — from pasted or OCR'd text.
 * Pure function; everything it extracts is confirmed by the user afterwards.
 */
import type { Player, SportId, Team } from "@/lib/types";
import { parseScenarios } from "./pick";

export type Leg =
  | { kind: "player"; playerId: string; statKey: string; line: number; side: "over" | "under"; opponentId?: string }
  | { kind: "moneyline"; teamId: string; opponentId?: string }
  | { kind: "spread"; teamId: string; line: number; opponentId?: string }
  | { kind: "total"; teamId: string; side: "over" | "under"; line: number; opponentId?: string }
  | { kind: "draw"; teamId: string; opponentId?: string };

export interface ParsedLeg {
  raw: string;
  leg: Partial<Leg> & { kind: Leg["kind"] };
  sport: SportId | null;
  odds: number | null; // American odds shown for this leg, if any
  issues: string[];
}

export interface ParsedSlip {
  legs: ParsedLeg[];
  parlayOdds: number | null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9.+\-/@ ]/g, " ").replace(/\s+/g, " ").trim();
const ODDS_RE = /(?:^|\s)([+-]\d{3,4})(?=\s|$)/g;

interface TeamKey {
  team: Team;
  keys: string[]; // lower-case phrases
}

function teamIndex(teams: Team[]): TeamKey[] {
  const nickCount = new Map<string, number>();
  for (const t of teams) nickCount.set(t.name.toLowerCase(), (nickCount.get(t.name.toLowerCase()) ?? 0) + 1);
  return teams.map((t) => ({
    team: t,
    // full name always; nickname too (may be shared, e.g. "Kings" — resolved by the caller)
    keys: [t.fullName.toLowerCase(), t.name.toLowerCase()].filter((k, i, a) => k.length > 2 && a.indexOf(k) === i),
  }));
}

/** Teams mentioned in a line: full names/nicknames, plus exact upper-case abbreviations. */
function teamsIn(line: string, idx: TeamKey[], preferTeam?: (cands: Team[]) => Team): Team[] {
  const n = " " + norm(line) + " ";
  const found: { team: Team; at: number; len: number }[] = [];
  for (const { team, keys } of idx) {
    for (const k of keys) {
      const at = n.indexOf(" " + k + " ");
      if (at >= 0) found.push({ team, at, len: k.length });
    }
  }
  for (const tok of line.split(/[^A-Za-z]+/)) {
    if (tok.length >= 2 && tok.length <= 4 && tok === tok.toUpperCase()) {
      for (const { team } of idx) if (team.abbreviation === tok) found.push({ team, at: n.indexOf(" " + tok.toLowerCase()), len: tok.length });
    }
  }
  // longest match wins at a position; group same-named candidates (e.g. two "Kings") and resolve
  found.sort((a, b) => a.at - b.at || b.len - a.len);
  const full = found.filter((f) => f.len > f.team.name.length);
  const inside = (f: (typeof found)[number]) => full.some((g) => g !== f && f.at >= g.at && f.at < g.at + g.len + 1);
  const out: Team[] = [];
  const byName = new Map<string, Team[]>();
  for (const f of found) {
    if (f.len <= f.team.name.length && inside(f)) continue; // "Jets" inside "Winnipeg Jets"
    const key = f.len > f.team.name.length ? f.team.id : f.team.name.toLowerCase(); // full-name matches are unambiguous
    byName.set(key, [...(byName.get(key) ?? []), f.team]);
  }
  for (const cands of byName.values()) {
    const uniq = [...new Map(cands.map((t) => [t.id, t])).values()];
    const pick = uniq.length === 1 ? uniq[0] : preferTeam ? preferTeam(uniq) : uniq[0];
    if (!out.some((t) => t.id === pick.id)) out.push(pick);
  }
  return out;
}

/** Does the text carry a bet market (odds, a line, ML, over/under…)? Word-bounded: "Thunder" is not "under". */
function hasMarket(t: string) {
  return /(^|\s)[+-]\d|\b(over|under|o|u)\s?\d|\b(moneyline|money line|ml|total|spread|draw|tie|to win|winner|pk|pick'?em)\b/i.test(t);
}

/** Text with a numeric market: a signed number (odds/spread) or an over/under number. */
function hasPriced(t: string) {
  return /(^|\s)[+-]\d|\b(over|under|o|u)\s?\d/i.test(t);
}

/** Blank out team full names and nicknames (keeps line structure). */
function maskTeams(lines: string[], teams: Team[]): string[] {
  const phrases = [...new Set(teams.flatMap((t) => [t.fullName, t.name]).filter((x) => x.length > 2))].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(^|[^A-Za-z])(${phrases.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=[^A-Za-z]|$)`, "gi");
  return lines.map((l) => l.replace(re, (_m, pre: string, name: string) => pre + " ".repeat(name.length)));
}

export function parseSlip(
  text: string,
  dir: { players: Player[]; teams: Team[] },
  refDate = new Date(),
  preferTeam?: (cands: Team[]) => Team,
): ParsedSlip {
  const clean = text.replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ");
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const idx = teamIndex(dir.teams);
  const legs: ParsedLeg[] = [];

  // parlay odds: an odds token on a line that mentions the parlay / payout
  let parlayOdds: number | null = null;
  for (const l of lines) {
    if (/parlay|\blegs?\b|\bodds\b|payout|\bsgp\b/i.test(l)) {
      const m = [...l.matchAll(ODDS_RE)];
      if (m.length) parlayOdds = Number(m[m.length - 1][1]);
    }
  }

  // matchup headers ("Knicks @ Pacers") name the game for the legs next to them
  const headerAt = (i: number) => {
    if (i < 0 || i >= lines.length || hasMarket(lines[i])) return null;
    const ts = teamsIn(lines[i], idx, preferTeam);
    return ts.length >= 2 ? ts : null;
  };
  const oppFromHeaders = (teamId: string | undefined, around: number[]) => {
    if (!teamId) return undefined;
    for (const i of around) {
      const h = headerAt(i);
      const me = h?.find((t) => t.id === teamId);
      if (me) return h!.find((t) => t.id !== teamId && t.sport === me.sport)?.id;
    }
    return undefined;
  };
  const playerById = new Map(dir.players.map((p) => [p.id, p]));

  // player legs first. Team names are masked so words inside them ("Vegas Golden Knights",
  // "Boston Celtics") are never read as player surnames; each player is then re-parsed on
  // just its own lines so stat words from other legs can't leak in.
  const masked = maskTeams(lines, dir.teams);
  const playerLines = new Set<number>();
  const scen = parseScenarios(masked.join("\n"), dir, refDate);
  const lower = masked.map((l) => norm(l));
  const surnameOf = (n: string | null) => (n ?? "").toLowerCase().split(" ").slice(-1)[0];
  const used = new Set<number>();
  for (const s0 of scen) {
    const surname = surnameOf(s0.playerName);
    const at = surname ? lower.findIndex((l, i) => !used.has(i) && (" " + l + " ").includes(" " + surname + " ")) : -1;
    const span: string[] = [];
    if (at >= 0) {
      used.add(at);
      for (let k = at; k < Math.min(lines.length, at + 3); k++) {
        if (k > at && (teamsIn(lines[k], idx).length || scen.some((o) => o !== s0 && o.playerName && (" " + lower[k] + " ").includes(" " + surnameOf(o.playerName) + " ")))) break;
        playerLines.add(k);
        span.push(lines[k]);
      }
    }
    const s = (span.length && parseScenarios(maskTeams(span, dir.teams).join("\n"), dir, refDate).find((x) => x.playerId === s0.playerId)) || s0;
    // a lone surname with no statistic or number is almost always a false match
    if (s.issues.some((x) => /last name only/.test(x)) && !s.statKey && s.threshold == null) {
      for (let k = at; k >= 0 && k < at + span.length; k++) playerLines.delete(k);
      continue;
    }
    const issues = [...s.issues];
    if (!s.side) issues.push("Side not shown — defaulted to Over");
    const oddsM = [...span.join(" ").matchAll(ODDS_RE)];
    legs.push({
      raw: span.length ? span.join(" · ").slice(0, 160) : s.raw,
      sport: s.sport,
      odds: oddsM.length ? Number(oddsM[oddsM.length - 1][1]) : null,
      issues,
      leg: {
        kind: "player",
        playerId: s.playerId ?? undefined,
        statKey: s.statKey ?? undefined,
        line: s.threshold ?? undefined,
        side: s.side ?? "over",
        opponentId: at >= 0 ? oppFromHeaders(playerById.get(s.playerId ?? "")?.teamId, [at + span.length, at - 1, at - 2]) : undefined,
      },
    });
  }

  // team legs: a line naming a team (and no player) plus up to two following lines
  const PARLAY_LINE = /parlay|\blegs?\b|payout|\bsgp\b|wager|to pay/i;
  let consumed = 0; // lines before this index already belong to a leg
  for (let i = 0; i < lines.length; i++) {
    if (playerLines.has(i)) continue;
    const ts = teamsIn(lines[i], idx, preferTeam);
    if (!ts.length) continue;
    const window: string[] = [lines[i]];
    // the market may sit on the line above the teams ("Over 6.5  -105" / "Total Goals · A @ B")
    const prev = i - 1;
    if (prev >= consumed && prev >= 0 && !playerLines.has(prev) && !PARLAY_LINE.test(lines[prev]) && hasMarket(lines[prev]) && !teamsIn(lines[prev], idx).length)
      window.unshift(lines[prev]);
    let j = i + 1;
    while (j < lines.length && window.length < 3 && !playerLines.has(j)) {
      const next = teamsIn(lines[j], idx, preferTeam);
      // another team starts a new leg, unless this window is a lone team still waiting for its
      // opponent (a game total written "Oilers" / "Maple Leafs" / "Over 6.5")
      if (next.length && (hasMarket(window.join(" ")) || teamsIn(window.join(" "), idx, preferTeam).length >= 2)) break;
      // a line with its own number market starts the next leg ("Spread" / "Over 6.5 -105")
      if (!next.length && hasPriced(lines[j]) && hasPriced(window.join(" "))) break;
      window.push(lines[j]);
      j++;
    }
    const w = window.join(" ");
    const wl = norm(w);
    const teamsHere = teamsIn(w, idx, preferTeam);
    const team = teamsHere[0];
    const oddsM = [...w.matchAll(ODDS_RE)].map((m) => Number(m[1]));
    const odds = oddsM.length ? oddsM[oddsM.length - 1] : null;
    const issues: string[] = [];
    let leg: ParsedLeg["leg"] | null = null;

    if (teamsHere.length >= 2 && !hasMarket(w)) continue; // matchup header ("Knicks @ Pacers"), not a bet
    const ou = wl.match(/\b(over|under|o|u)\s?(\d+(?:\.\d+)?)\b/);
    if (/\bdraw\b|\btie\b/.test(wl)) leg = { kind: "draw", teamId: team.id };
    else if (ou && (teamsHere.length >= 2 || /total/.test(wl))) {
      if (/team total/.test(wl)) issues.push("Team totals aren't modelled — treated as the game total");
      leg = { kind: "total", teamId: team.id, side: ou[1].startsWith("o") ? "over" : "under", line: Number(ou[2]) };
    } else if (/moneyline|money line|\bml\b|to win|winner/.test(wl)) leg = { kind: "moneyline", teamId: team.id };
    else {
      // spread: a signed small number (not 3-4 digit odds) after the team
      const sp = [...w.matchAll(/(?:^|\s)([+-]\d{1,2}(?:\.\d)?)(?=\s|$)/g)].map((m) => Number(m[1])).find((v) => Math.abs(v) <= 60);
      if (sp != null) leg = { kind: "spread", teamId: team.id, line: sp };
      else if (odds != null) leg = { kind: "moneyline", teamId: team.id }; // "Lakers +150" with no market is a moneyline
    }
    if (!leg) continue;
    const opp = teamsHere.find((t) => t.id !== team.id && t.sport === team.sport)?.id ?? oppFromHeaders(team.id, [j, i - 1, i - 2]);
    if (opp) (leg as { opponentId?: string }).opponentId = opp;
    if (teamsHere.length >= 2 && leg.kind !== "total" && leg.kind !== "draw") issues.push(`Two teams on this leg — assumed ${team.fullName}, please confirm`);
    legs.push({ raw: w.slice(0, 160), sport: team.sport, odds, issues, leg });
    i = j - 1;
    consumed = j;
  }
  return { legs, parlayOdds };
}

export function impliedProbability(american: number) {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
export function fairAmerican(p: number) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
