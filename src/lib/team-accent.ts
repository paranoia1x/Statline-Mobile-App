/**
 * Turns a team's colours into the five accent shades the theme uses (CSS "r g b" triplets).
 * Picks whichever team colour is more usable as an accent (saturated, not near-black or
 * near-white), then normalises its lightness so it reads well on dark and light themes.
 * Pure function: used by the server (first paint) and the browser (live preview).
 */
type RGB = [number, number, number];

const hexToRgb = (h: string): RGB | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as RGB;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)) as RGB;
}

const triplet = (c: RGB) => c.join(" ");
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** How good a colour is as an accent: saturated and mid-lightness. */
function usability(c: RGB) {
  const [, s, l] = rgbToHsl(c);
  return s * (1 - Math.abs(l - 0.5) * 1.6);
}

export interface AccentShades {
  base: string;
  light: string;
  bright: string;
  deep: string;
  ai: string;
}

export function teamAccent(colors: { primary: string; secondary: string }): AccentShades {
  const cands = [colors.primary, colors.secondary].map(hexToRgb).filter((c): c is RGB => !!c);
  const best = cands.sort((a, b) => usability(b) - usability(a))[0];
  let [h, s] = best ? rgbToHsl(best) : [0, 0, 0.5];
  // black/white/grey teams: a neutral steel accent instead of an invisible one
  if (s < 0.12) [h, s] = [0.6, 0.08];
  s = clamp(s, 0.35, 0.9);
  return {
    base: triplet(hslToRgb(h, s, 0.45)),
    light: triplet(hslToRgb(h, clamp(s, 0.4, 0.85), 0.78)),
    bright: triplet(hslToRgb(h, s, 0.6)),
    deep: triplet(hslToRgb(h, s, 0.34)),
    ai: triplet(hslToRgb(h, s, 0.55)),
  };
}

/** The CSS variables for a team accent, as an inline-style object. */
export function teamAccentVars(colors: { primary: string; secondary: string }): Record<string, string> {
  const a = teamAccent(colors);
  return { "--acc-base": a.base, "--acc-light": a.light, "--acc-bright": a.bright, "--acc-deep": a.deep, "--acc-ai": a.ai };
}
