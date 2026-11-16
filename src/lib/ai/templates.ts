/**
 * Deterministic narrative templates, used when no language model is
 * configured. They only restate numbers computed by the statistical engine.
 */
import type { PlayerForecast } from "@/lib/engine/player-forecast";
import type { GameForecast, MatchupEdge, TeamProfile } from "@/lib/engine/team";
import type { Pattern } from "@/lib/engine/patterns";

const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;

export function forecastTemplate(f: PlayerForecast, playerName: string, opponentName: string, demo: boolean) {
  const lean = f.lean === "neutral" ? "roughly balanced around" : f.lean === "over" ? "leaning above" : "leaning below";
  const top = f.supporting[0]?.text;
  const against = f.conflicting[0]?.text;
  return [
    `${demo ? "Using demo data, the" : "The"} model projects ${f.projection.toFixed(1)} ${f.statLabel.toLowerCase()} for ${playerName} against ${opponentName}, ${lean} the hypothetical threshold of ${f.threshold}.`,
    `Estimated probability of exceeding it is ${p1(f.pOver)} and of falling below it ${p1(f.pUnder)}, with ${f.confidence.level} confidence (${f.confidence.reasons.join(", ")}).`,
    top ? `The strongest supporting signal: ${lowerFirst(top)}` : "",
    against ? `Working against it: ${lowerFirst(against)}` : "",
    `Based on ${f.sample.games} completed games; this is a probabilistic estimate, not a guarantee.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function teamTemplate(p: TeamProfile, strengths: string[], weaknesses: string[], demo: boolean) {
  const rec = `${p.record.w}-${p.record.l}${p.record.d ? `-${p.record.d}` : ""}`;
  return [
    `${demo ? "In the demo data set, the" : "The"} ${p.team.fullName} are ${rec} across ${p.games} games this season.`,
    strengths.length ? `Their clearest strengths by league rank: ${strengths.slice(0, 3).join("; ")}.` : "No metric ranks clearly above the league.",
    weaknesses.length ? `Areas that rank near the bottom: ${weaknesses.slice(0, 3).join("; ")}.` : "No metric ranks clearly below the league.",
    "Ranks are relative to the current league sample and can shift quickly early in a season.",
  ].join(" ");
}

export function matchupTemplate(homeName: string, awayName: string, gf: GameForecast, edges: MatchupEdge[], demo: boolean) {
  const off = edges.filter((e) => e.verdict !== "even").slice(0, 3).map((e) => e.text);
  return [
    `${demo ? "With demo data, the" : "The"} team model projects ${awayName} ${gf.awayExpected.toFixed(1)} – ${homeName} ${gf.homeExpected.toFixed(1)}.`,
    `Estimated win probability: ${homeName} ${p1(gf.pHomeWin)}, ${awayName} ${p1(gf.pAwayWin)}${gf.pDraw > 0 ? `, draw ${p1(gf.pDraw)}` : ""}.`,
    off.length ? `Notable unit matchups: ${off.join(" ")}` : "No unit matchup shows a large statistical edge.",
    "Recent win/loss streaks are not used as predictors.",
  ].join(" ");
}

export function insightFromPattern(name: string, p: Pattern) {
  return `${name}: ${p.title.toLowerCase()} — ${p.detail}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
