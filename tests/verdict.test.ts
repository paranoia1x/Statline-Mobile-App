import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DEMO_NOW = "2026-11-14T12:00:00Z";
import { setProvider } from "../src/lib/data";
import { DemoProvider } from "./fixtures/demo";
setProvider(new DemoProvider());
import { buildVerdict, labelFor, strengthOf } from "../src/lib/engine/verdict";
import { forecastPlayerStat } from "../src/lib/engine/service";
import { runBacktest } from "../src/lib/engine/evaluation";

test("labels follow calibrated probability bands", () => {
  assert.equal(labelFor(0.7, "high"), "Likely hit");
  assert.equal(labelFor(0.57, "high"), "Lean hit");
  assert.equal(labelFor(0.5, "high"), "Toss-up");
  assert.equal(labelFor(0.43, "medium"), "Lean miss");
  assert.equal(labelFor(0.2, "medium"), "Likely miss");
});

test("low confidence caps a strong call at Lean", () => {
  assert.equal(strengthOf(0.8, "low"), "lean");
  assert.equal(labelFor(0.8, "low"), "Lean hit");
  assert.equal(labelFor(0.2, "low"), "Lean miss");
});

test("verdict for each side is complementary and explains both sides", async () => {
  const { forecast: f } = await forecastPlayerStat({ playerId: "nba-tobias-delacroix", statKey: "pts", threshold: 12.5 });
  const above = buildVerdict(f, "Tobias Delacroix", "over");
  const below = buildVerdict(f, "Tobias Delacroix", "under");
  assert.ok(Math.abs(above.pHit - below.pMiss) < 1e-9);
  assert.equal(above.sideSource, "user");
  assert.ok(above.pHit > below.pHit, "low threshold should favour 'above'");
  assert.ok(above.label.endsWith("hit"));
  assert.ok(below.label.endsWith("miss"));
  assert.ok(above.caveats.some((c) => /not a guarantee/.test(c)));
  const def = buildVerdict(f, "Tobias Delacroix", null);
  assert.equal(def.side, "over", "no side given means 'will it clear the threshold'");
  assert.equal(def.sideSource, "default");
});

test("backtest reports how often each verdict strength was right", async () => {
  const bt = await runBacktest("nba");
  const t = bt.verdictTrack;
  assert.equal(t.likely.n + t.lean.n + t.tossup.n, bt.metrics.n);
  for (const k of ["likely", "lean", "tossup"] as const) if (t[k].n) assert.ok(t[k].rate! >= 0 && t[k].rate! <= 1);
});
