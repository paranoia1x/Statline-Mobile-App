/** Registry of statistical model versions. Every stored prediction records the version that produced it. */
export const MODEL_VERSIONS = [
  {
    id: "stat-forecast-1.0.0",
    released: "2026-11-14",
    description:
      "Shrunken EWMA baseline (recent form, season, career) with opponent-allowance, home/away, playing-time, head-to-head and availability adjustments; negative-binomial / normal outcome distributions; walk-forward backtest calibration.",
  },
];
export const CURRENT_MODEL_VERSION = MODEL_VERSIONS[MODEL_VERSIONS.length - 1].id;
