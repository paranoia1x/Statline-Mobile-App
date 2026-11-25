/** Registry of statistical model versions. Every stored prediction records the version that produced it. */
export const MODEL_VERSIONS = [
  {
    id: "stat-forecast-1.0.0",
    released: "2026-11-14",
    description:
      "Shrunken EWMA baseline (recent form, season, career) with opponent-allowance, home/away, playing-time, head-to-head and availability adjustments; negative-binomial / normal outcome distributions; walk-forward backtest calibration.",
  },
  {
    id: "stat-forecast-1.1.0",
    released: "2026-11-16",
    description:
      "Default line is the player's typical line (median of the last 10 games) instead of the model's own projection. Baseline weights retuned on the walk-forward backtest (slower-moving recent form, more season weight). NBA projections account for key teammates who are out. Players ruled out are flagged.",
  },
  {
    id: "stat-forecast-1.2.0",
    released: "2026-11-25",
    description:
      "Soccer forecasts use the betting market's implied team total (backtest: accuracy 77.8% → 78.7%). Forecasts show the market total for every sport when a line exists. Fantasy projections added (defense vs position, implied team totals, NFL weather).",
  },
];
export const CURRENT_MODEL_VERSION = MODEL_VERSIONS[MODEL_VERSIONS.length - 1].id;
