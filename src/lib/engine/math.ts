/** Small numerical toolkit used by the statistical models. */
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function sd(a: number[]) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function quantile(a: number[], q: number) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Exponentially weighted mean; most recent value last. */
export function ewma(values: number[], halfLife: number) {
  if (!values.length) return NaN;
  const lambda = Math.log(2) / halfLife;
  let num = 0;
  let den = 0;
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-lambda * (n - 1 - i));
    num += w * values[i];
    den += w;
  }
  return num / den;
}

/** Least-squares slope of values against their index. */
export function slope(values: number[]) {
  const n = values.length;
  if (n < 3) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) ** 2;
  }
  return den ? num / den : 0;
}

/** Welch t statistic for difference in means. */
export function welchT(a: number[], b: number[]) {
  if (a.length < 2 || b.length < 2) return 0;
  const va = sd(a) ** 2 / a.length;
  const vb = sd(b) ** 2 / b.length;
  const d = Math.sqrt(va + vb);
  return d ? (mean(a) - mean(b)) / d : 0;
}

export function erf(x: number) {
  // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normCdf = (x: number, m = 0, s = 1) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));

function logGamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function poissonPmf(k: number, lambda: number) {
  if (k < 0) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
}

/** Negative binomial pmf parameterised by mean mu and variance v (v > mu). */
export function negBinPmf(k: number, mu: number, v: number) {
  if (v <= mu * 1.0001) return poissonPmf(k, mu);
  const r = (mu * mu) / (v - mu);
  const p = r / (r + mu);
  return Math.exp(logGamma(k + r) - logGamma(r) - logGamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p));
}

/** Discrete distribution as an array of probabilities over 0..K. */
export function countDistribution(mu: number, variance: number): number[] {
  const out: number[] = [];
  const maxK = Math.ceil(mu + 10 * Math.sqrt(Math.max(variance, mu, 1)) + 10);
  let total = 0;
  for (let k = 0; k <= maxK; k++) {
    const p = negBinPmf(k, Math.max(mu, 1e-6), variance);
    out.push(p);
    total += p;
  }
  return out.map((p) => p / total);
}

export const logit = (p: number) => Math.log(p / (1 - p));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
