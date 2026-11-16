/**
 * Appearance options (theme, accent colour, text size). Stored in a cookie so the
 * server renders the chosen look on the first paint — no flash of the default theme.
 * The colours themselves live in src/app/themes.css as CSS variables.
 */
/** swatch = [page, card, border, text] for the preview tiles. */
export const THEMES = [
  { id: "midnight", label: "Midnight", hint: "Deep violet-black (default)", swatch: ["#06040b", "#120f19", "#27212f", "#e9e7ef"] },
  { id: "carbon", label: "Carbon", hint: "Neutral graphite", swatch: ["#0a0a0b", "#1c1c1f", "#3a3a40", "#ececef"] },
  { id: "navy", label: "Navy", hint: "Blue-tinted dark", swatch: ["#050a14", "#131d30", "#2c3d5a", "#e6ebf3"] },
  { id: "oled", label: "OLED Black", hint: "Pure black, best on OLED screens", swatch: ["#000000", "#111111", "#2e2e2e", "#ececec"] },
  { id: "dim", label: "Dim", hint: "Softer dark grey, easy on the eyes", swatch: ["#1c2128", "#2d333b", "#444c56", "#cdd9e5"] },
  { id: "light", label: "Light", hint: "Bright, for daytime", swatch: ["#eceaf3", "#ffffff", "#d6d2e2", "#1f1b2e"] },
  { id: "paper", label: "Paper", hint: "Warm off-white, like a printed page", swatch: ["#f5f1e8", "#fffdf8", "#e3dccb", "#2b2418"] },
  { id: "auto", label: "Auto", hint: "Follows your system light/dark setting", swatch: ["#06040b", "#f4f3f8", "#27212f", "#e9e7ef"] },
] as const;

export const ACCENTS = [
  { id: "violet", label: "Violet", color: "#7c16e3" },
  { id: "blue", label: "Blue", color: "#2f6fed" },
  { id: "teal", label: "Teal", color: "#0d9488" },
  { id: "green", label: "Green", color: "#16a34a" },
  { id: "orange", label: "Orange", color: "#ea580c" },
  { id: "rose", label: "Rose", color: "#e11d48" },
  { id: "gold", label: "Gold", color: "#ca8a04" },
] as const;

export const TEXT_SIZES = [
  { id: "sm", label: "Compact", px: 14 },
  { id: "md", label: "Default", px: 16 },
  { id: "lg", label: "Large", px: 17.5 },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
/** A fixed colour, or "team": the colours of `Appearance.team`. */
export type AccentId = (typeof ACCENTS)[number]["id"] | "team";
export type TextSizeId = (typeof TEXT_SIZES)[number]["id"];

export interface Appearance {
  theme: ThemeId;
  accent: AccentId;
  size: TextSizeId;
  team: string | null; // team id when accent is "team"
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "midnight", accent: "violet", size: "md", team: null };
export const APPEARANCE_COOKIE = "sl_appearance";

const TEAM_ID = /^[a-z]{2,8}-[a-z0-9]{1,16}$/;

/** Parses the cookie value ("theme.accent.size[.teamId]"); unknown parts fall back to defaults. */
export function parseAppearance(raw: string | undefined | null): Appearance {
  const [t, a, s, team] = (raw ?? "").split(".");
  const teamOk = !!team && TEAM_ID.test(team);
  const accentOk = ACCENTS.some((x) => x.id === a) || (a === "team" && teamOk);
  return {
    theme: THEMES.some((x) => x.id === t) ? (t as ThemeId) : DEFAULT_APPEARANCE.theme,
    accent: accentOk ? (a as AccentId) : DEFAULT_APPEARANCE.accent,
    size: TEXT_SIZES.some((x) => x.id === s) ? (s as TextSizeId) : DEFAULT_APPEARANCE.size,
    team: teamOk ? team : null,
  };
}

export const serializeAppearance = (a: Appearance) => [a.theme, a.accent, a.size, a.team].filter(Boolean).join(".");
