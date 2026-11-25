/**
 * Tunes the fantasy projection settings on the walk-forward backtest (real ESPN snapshots in
 * public/data, built by `npm run data`). Coordinate descent on mean absolute error.
 *
 *   npx tsx scripts/tune-fantasy.ts [sport]
 */
import fs from "node:fs";
import path from "node:path";
import { setProvider } from "@/lib/data";
import { SnapshotProvider } from "@/lib/data/snapshot";
import type { SportSnapshot } from "@/lib/data/snapshot-format";
import { SPORT_IDS, type SportId } from "@/lib/types";
import { getFormat } from "@/lib/fantasy/formats";
import { FANTASY_PARAMS, loadFantasyData, type FantasyParams } from "@/lib/fantasy/engine";
import { backtestSamples, summarize } from "@/lib/fantasy/backtest";

const DIR = path.join(process.cwd(), "public", "data");
const prov = new SnapshotProvider("");
setProvider(prov);
const only = process.argv[2] as SportId | undefined;

const GRID: Partial<Record<keyof FantasyParams, number[]>> = {
  halfLife: [4, 6, 8, 10, 14, 20],
  wRecent: [0.2, 0.35, 0.5, 0.65, 0.8],
  shrinkK: [0, 1, 2, 3, 5],
  dvp: [0, 0.25, 0.5, 0.75, 1],
  dvpWindow: [6, 10, 15, 20],
  dvpK: [2, 4, 6, 10],
  env: [0, 0.4, 0.6, 0.8, 1, 1.2],
  b2b: [0.94, 0.96, 0.98, 1],
  minutes: [0, 0.2, 0.4, 0.6, 0.8],
};

for (const sport of SPORT_IDS) {
  if (only && sport !== only) continue;
  const snap = JSON.parse(fs.readFileSync(path.join(DIR, `${sport}.json`), "utf8")) as SportSnapshot;
  prov.attach(snap);
  const format = getFormat(null, sport);
  const data = await loadFantasyData(sport, format);
  let best = { ...FANTASY_PARAMS[sport] };
  // tune on the older 70% of target games, report on the most recent 30% (held out)
  const all0 = backtestSamples(data, best).map((s) => s.date).sort();
  const cutoff = all0[Math.floor(all0.length * 0.7)];
  const score = (p: FantasyParams) => summarize(sport, format.id, backtestSamples(data, p).filter((s) => s.date < cutoff));
  const holdout = (p: FantasyParams) => summarize(sport, format.id, backtestSamples(data, p).filter((s) => s.date >= cutoff));
  let cur = score(best);
  console.log(sport, "start (train)", fmt(cur));
  console.log(sport, "start (holdout)", fmt(holdout(best)));
  for (let round = 0; round < 2; round++)
    for (const [k, vals] of Object.entries(GRID) as [keyof FantasyParams, number[]][]) {
      for (const v of vals) {
        const p = { ...best, [k]: v, ...(k === "wRecent" ? { wSeason: 1 - v } : {}) };
        const r = score(p);
        if (r.mae < cur.mae - 1e-4) (best = p), (cur = r);
      }
    }
  console.log(sport, "best", JSON.stringify(best));
  console.log(sport, "tuned (train)", fmt(cur));
  console.log(sport, "tuned (HOLDOUT)", fmt(holdout(best)));
  console.log(sport, "holdout without matchup+environment", fmt(holdout({ ...best, dvp: 0, env: 0 })));
}

function fmt(r: ReturnType<typeof summarize>) {
  return `n=${r.n} MAE ${r.mae.toFixed(3)} | season avg ${r.maeSeason.toFixed(3)} | last5 ${r.maeLast5.toFixed(3)} | start/sit ${((r.startSit ?? 0) * 100).toFixed(1)}% vs season ${((r.startSitSeason ?? 0) * 100).toFixed(1)}% (${r.pairs} pairs)`;
}
process.exit(0);
