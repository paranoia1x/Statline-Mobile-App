/**
 * Checks the player-stat (prop) model's optional inputs on the walk-forward backtest using the real
 * snapshots in public/data: betting-market team totals (envStrength) and back-to-backs.
 *
 *   npx tsx scripts/tune-props.ts [sport]
 */
import fs from "node:fs";
import path from "node:path";
import { setProvider } from "@/lib/data";
import { SnapshotProvider } from "@/lib/data/snapshot";
import type { SportSnapshot } from "@/lib/data/snapshot-format";
import { clearBacktestCache, runBacktest } from "@/lib/engine/evaluation";
import { MODEL_PARAMS } from "@/lib/engine/player-forecast";
import { SPORT_IDS, type SportId } from "@/lib/types";

const prov = new SnapshotProvider("");
setProvider(prov);
const only = process.argv[2] as SportId | undefined;
for (const sport of SPORT_IDS) {
  if (only && sport !== only) continue;
  prov.attach(JSON.parse(fs.readFileSync(path.join("public", "data", `${sport}.json`), "utf8")) as SportSnapshot);
  const opp0 = MODEL_PARAMS.oppStrength;
  const run = async (env: number, b2b: number, opp = opp0) => {
    MODEL_PARAMS.oppStrength = opp;
    MODEL_PARAMS.envStrength[sport] = env;
    MODEL_PARAMS.backToBack[sport] = b2b;
    clearBacktestCache();
    const r = await runBacktest(sport);
    return r.metrics;
  };
  const show = (label: string, m: Awaited<ReturnType<typeof run>>) =>
    console.log(sport, label.padEnd(18), `n=${m.n} logloss ${m.logLoss?.toFixed(4)} brierRaw ${m.brierRaw?.toFixed(4)} brierCal ${m.brierCalibrated?.toFixed(4)} acc ${((m.accuracy ?? 0) * 100).toFixed(2)}%`);
  show("baseline", await run(0, 1));
  for (const e of [0.3, 0.5, 0.7, 1.0]) show(`env ${e}`, await run(e, 1));
  for (const e of [0.3, 0.6]) show(`env ${e} opp 0.4`, await run(e, 1, 0.4));
  show("opp 0.4 only", await run(0, 1, 0.4));
  if (sport === "nba" || sport === "nhl") for (const b of [0.94, 0.97]) show(`b2b ${b}`, await run(0, b));
}
process.exit(0);
