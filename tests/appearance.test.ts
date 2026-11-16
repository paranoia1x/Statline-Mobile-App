import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamAccent } from "../src/lib/team-accent";
import { ACCENTS, DEFAULT_APPEARANCE, THEMES, parseAppearance, serializeAppearance } from "../src/lib/appearance";

test("appearance cookie round-trips and rejects unknown values", () => {
  const a = { theme: "light", accent: "teal", size: "lg", team: null } as const;
  assert.deepEqual(parseAppearance(serializeAppearance(a)), a);
  const t = { theme: "paper", accent: "team", size: "md", team: "nba-t25" } as const;
  assert.equal(serializeAppearance(t), "paper.team.md.nba-t25");
  assert.deepEqual(parseAppearance(serializeAppearance(t)), t);
  // a team accent without a valid team falls back to the default accent
  assert.equal(parseAppearance("dim.team.md").accent, DEFAULT_APPEARANCE.accent);
  assert.equal(parseAppearance("dim.team.md.<x>").accent, DEFAULT_APPEARANCE.accent);
  assert.deepEqual(parseAppearance(undefined), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("evil\"><script>.pink.huge"), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("oled"), { ...DEFAULT_APPEARANCE, theme: "oled" });
});

test("every theme and accent has CSS variables", () => {
  const css = readFileSync(new URL("../src/themes.css", import.meta.url), "utf8");
  for (const t of THEMES) assert.ok(css.includes(`[data-theme="${t.id}"]`), `theme ${t.id}`);
  for (const a of ACCENTS) assert.ok(css.includes(`[data-accent="${a.id}"]`), `accent ${a.id}`);
});

test("team accents pick the usable colour and fix its lightness", () => {
  const lum = (t: string) => t.split(" ").map(Number).reduce((a, v, i) => a + v * [0.299, 0.587, 0.114][i], 0);
  // black primary, gold secondary -> a gold-ish accent, not black
  const a = teamAccent({ primary: "#000000", secondary: "#fdb927" });
  const [r, g, b] = a.base.split(" ").map(Number);
  assert.ok(r > b && g > b, `expected warm accent, got ${a.base}`);
  // black/white team -> neutral but visible accent
  const bw = teamAccent({ primary: "#000000", secondary: "#ffffff" });
  assert.ok(lum(bw.base) > 60 && lum(bw.base) < 200, bw.base);
  // shades are ordered deep < base < bright < light
  assert.ok(lum(a.deep) < lum(a.base) && lum(a.base) < lum(a.bright) && lum(a.bright) < lum(a.light));
});
