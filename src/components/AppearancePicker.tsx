"use client";

import { apiFetch } from "@/lib/api";

import { useEffect, useRef, useState } from "react";
import { ACCENTS, DEFAULT_APPEARANCE, TEXT_SIZES, THEMES, parseAppearance, serializeAppearance, type Appearance } from "@/lib/appearance";
import { cx } from "@/lib/format";
import { NavIcon } from "./icons";
import { APPEARANCE_ICON } from "./nav";
import { TeamLogo } from "./media";
import { teamAccent, teamAccentVars } from "@/lib/team-accent";

interface PickerTeam {
  id: string;
  sport: string;
  fullName: string;
  abbreviation: string;
  colors: { primary: string; secondary: string };
  logoUrl: string | null;
}

// loaded once per page, on first use of the team picker
let teamsPromise: Promise<PickerTeam[]> | null = null;
const loadTeams = () =>
  (teamsPromise ??= apiFetch("/api/teams")
    .then((r) => (r.ok ? r.json() : { teams: [] }))
    .then((d) => d.teams as PickerTeam[])
    .catch(() => {
      teamsPromise = null;
      return [];
    }));

const ACCENT_VARS = ["--acc-base", "--acc-light", "--acc-bright", "--acc-deep", "--acc-ai"];

const STORAGE_KEY = "sl.appearance";

function readSaved(): (Appearance & { vars?: Record<string, string> }) | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function readCurrent(): Appearance {
  const s = readSaved();
  return s ? parseAppearance(serializeAppearance({ ...DEFAULT_APPEARANCE, ...s })) : DEFAULT_APPEARANCE;
}

/** Colours the phone's status bar to match the page background. */
function syncThemeColor() {
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

function apply(a: Appearance, teamColors?: PickerTeam["colors"]) {
  const el = document.documentElement;
  el.dataset.theme = a.theme;
  el.dataset.accent = a.accent;
  el.dataset.size = a.size;
  let vars = readSaved()?.vars;
  if (a.accent === "team" && teamColors) vars = teamAccentVars(teamColors);
  if (a.accent !== "team") vars = undefined;
  ACCENT_VARS.forEach((k) => el.style.removeProperty(k));
  if (vars) for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...a, vars }));
  } catch {
    /* private mode: applies for this session only */
  }
  requestAnimationFrame(syncThemeColor);
  window.dispatchEvent(new CustomEvent("appearance-change", { detail: a }));
}

export { syncThemeColor };

function useAppearance(): [Appearance, (patch: Partial<Appearance>, teamColors?: PickerTeam["colors"]) => void] {
  const [a, setA] = useState<Appearance>(DEFAULT_APPEARANCE);
  useEffect(() => {
    setA(readCurrent());
    const on = (e: Event) => setA((e as CustomEvent<Appearance>).detail);
    window.addEventListener("appearance-change", on);
    return () => window.removeEventListener("appearance-change", on);
  }, []);
  return [a, (patch, teamColors) => apply({ ...readCurrent(), ...patch }, teamColors)];
}

/** A tiny mock of the app in a theme: sidebar with the active item, and a card with text. */
function Mini({ sw, accent }: { sw: readonly string[]; accent: string }) {
  const [page, card, border, text] = sw;
  return (
    <span className="flex flex-1" style={{ background: page }}>
      <span className="flex w-1/4 flex-col gap-1 p-1.5" style={{ borderRight: `1px solid ${border}` }}>
        <span className="h-1.5 rounded-sm" style={{ background: accent }} />
        <span className="h-1 w-3/4 rounded-sm opacity-40" style={{ background: text }} />
        <span className="h-1 w-2/3 rounded-sm opacity-40" style={{ background: text }} />
      </span>
      <span className="flex flex-1 p-1.5">
        <span className="flex flex-1 flex-col gap-1 rounded p-1.5" style={{ background: card, border: `1px solid ${border}` }}>
          <span className="h-1.5 w-1/2 rounded-sm" style={{ background: text }} />
          <span className="h-1 w-3/4 rounded-sm opacity-40" style={{ background: text }} />
          <span className="mt-auto h-1.5 w-1/3 rounded-sm" style={{ background: accent }} />
        </span>
      </span>
    </span>
  );
}

const SPORT_TABS = [
  { id: "nba", label: "NBA" },
  { id: "nfl", label: "NFL" },
  { id: "mlb", label: "MLB" },
  { id: "nhl", label: "NHL" },
  { id: "soccer", label: "Soccer" },
];

/** Grid of team logos; picking one makes the app use that team's colours. */
function TeamGrid({ teams, selected, compact, onPick }: { teams: PickerTeam[] | null; selected: string | null; compact: boolean; onPick: (t: PickerTeam) => void }) {
  const [sport, setSport] = useState(() => (selected ? selected.split("-")[0] : "nba"));
  const [q, setQ] = useState("");
  if (!teams) return <div className="mt-3 h-24 animate-pulse rounded-lg bg-ink-800" />;
  if (!teams.length) return <div className="mt-3 text-xs text-ink-400">Teams couldn&apos;t be loaded right now.</div>;
  const query = q.trim().toLowerCase();
  const list = teams
    .filter((t) => (query ? t.fullName.toLowerCase().includes(query) || t.abbreviation.toLowerCase() === query : t.sport === sport))
    .sort((x, y) => x.fullName.localeCompare(y.fullName));
  return (
    <div className="mt-3 rounded-lg border border-ink-700 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {SPORT_TABS.map((s) => (
          <button key={s.id} onClick={() => (setSport(s.id), setQ(""))} className={cx("chip px-2.5 py-0.5", !query && sport === s.id && "chip-active")}>
            {s.label}
          </button>
        ))}
        <input className="input ml-auto h-7 w-32 px-2 py-1 text-xs" placeholder="Search team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search teams" />
      </div>
      <div className={cx("scrollbar-thin grid gap-1 overflow-y-auto", compact ? "max-h-52 grid-cols-4" : "max-h-72 grid-cols-3 sm:grid-cols-5 lg:grid-cols-8")}>
        {list.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            title={t.fullName}
            aria-pressed={selected === t.id}
            className={cx("flex flex-col items-center gap-1 rounded-md border p-1.5 text-[10px] transition", selected === t.id ? "border-brand-bright bg-brand/10 text-ink-100" : "border-transparent text-ink-300 hover:bg-ink-850")}
          >
            <TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="sm" />
            <span className="w-full truncate text-center">{compact ? t.abbreviation : t.fullName}</span>
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-1.5 w-3 rounded-full" style={{ background: t.colors.primary }} />
              <span className="h-1.5 w-3 rounded-full" style={{ background: t.colors.secondary }} />
            </span>
          </button>
        ))}
        {!list.length && <div className="col-span-full py-4 text-center text-xs text-ink-400">No team matches “{q}”.</div>}
      </div>
    </div>
  );
}

/** Full appearance controls: theme cards, accent swatches and text size. */
export function AppearancePanel({ compact = false }: { compact?: boolean }) {
  const [a, set] = useAppearance();
  const [teams, setTeams] = useState<PickerTeam[] | null>(null);
  const [showTeams, setShowTeams] = useState(false);
  useEffect(() => {
    if (a.accent === "team" || showTeams) loadTeams().then(setTeams);
  }, [a.accent, showTeams]);
  const myTeam = a.accent === "team" ? teams?.find((t) => t.id === a.team) : undefined;
  const accent = myTeam ? `rgb(${teamAccent(myTeam.colors).base})` : ACCENTS.find((c) => c.id === a.accent)?.color ?? ACCENTS[0].color;
  return (
    <div className="space-y-5">
      <div>
        <div className="label mb-2">Theme</div>
        <div className={cx("grid gap-2", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => set({ theme: t.id })}
              aria-pressed={a.theme === t.id}
              title={t.hint}
              className={cx(
                "group rounded-lg border p-2 text-left transition",
                a.theme === t.id ? "border-brand-bright ring-2 ring-brand-bright/30" : "border-ink-700 hover:border-ink-500",
              )}
            >
              {t.id === "auto" ? (
                <span className="flex h-14 overflow-hidden rounded-md border border-black/20" aria-hidden>
                  <Mini sw={THEMES[0].swatch} accent={accent} />
                  <Mini sw={THEMES[4].swatch} accent={accent} />
                </span>
              ) : (
                <span className="flex h-14 overflow-hidden rounded-md border border-black/20" aria-hidden>
                  <Mini sw={t.swatch} accent={accent} />
                </span>
              )}
              <span className="mt-1.5 block text-xs font-medium text-ink-100">{t.label}</span>
              {!compact && <span className="block text-[11px] text-ink-400">{t.hint}</span>}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-2">Accent colour</div>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => set({ accent: c.id })}
              aria-pressed={a.accent === c.id}
              aria-label={`${c.label} accent`}
              title={c.label}
              className={cx("flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition", a.accent === c.id ? "border-ink-300 text-ink-100" : "border-ink-700 text-ink-300 hover:border-ink-500")}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: c.color }}>
                {a.accent === c.id && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#fff" strokeWidth={3} aria-hidden>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </span>
              {c.label}
            </button>
          ))}
          <button
            onClick={() => setShowTeams((v) => !v)}
            aria-pressed={a.accent === "team"}
            aria-expanded={showTeams}
            className={cx("flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition", a.accent === "team" ? "border-ink-300 text-ink-100" : "border-ink-700 text-ink-300 hover:border-ink-500")}
          >
            {myTeam ? (
              <TeamLogo abbreviation={myTeam.abbreviation} name={myTeam.fullName} logoUrl={myTeam.logoUrl} colors={myTeam.colors} size="xs" className="!h-5 !w-5 rounded-full border-0" />
            ) : (
              <span className="flex h-5 w-5 overflow-hidden rounded-full" aria-hidden>
                <span className="flex-1 bg-[#c8102e]" />
                <span className="flex-1 bg-[#1d428a]" />
              </span>
            )}
            {myTeam ? `${myTeam.abbreviation} colours` : "Team colours"}
            <span className="text-ink-500" aria-hidden>{showTeams ? "▴" : "▾"}</span>
          </button>
        </div>
        {showTeams && <TeamGrid teams={teams} selected={a.accent === "team" ? a.team : null} compact={compact} onPick={(t) => set({ accent: "team", team: t.id }, t.colors)} />}
      </div>
      <div>
        <div className="label mb-2">Text size</div>
        <div className="inline-flex rounded-lg border border-ink-700 p-0.5">
          {TEXT_SIZES.map((s) => (
            <button
              key={s.id}
              onClick={() => set({ size: s.id })}
              aria-pressed={a.size === s.id}
              className={cx("rounded-md px-3 py-1.5 text-xs font-medium transition", a.size === s.id ? "bg-brand/20 text-white" : "text-ink-300 hover:text-ink-100")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {!compact && (
        <button className="btn btn-ghost text-xs" onClick={() => (set(DEFAULT_APPEARANCE), setShowTeams(false))}>
          Reset to default
        </button>
      )}
    </div>
  );
}

/** Top-bar button that opens the appearance panel in a popover. */
export function AppearanceButton() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={box}>
      <button className={cx("btn btn-ghost px-2", open && "bg-ink-800")} onClick={() => setOpen((o) => !o)} aria-label="Appearance" aria-expanded={open} title="Appearance">
        <NavIcon d={APPEARANCE_ICON} className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 scrollbar-thin max-h-[calc(100vh-4.5rem)] w-[min(92vw,360px)] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 shadow-2xl" role="dialog" aria-label="Appearance">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-ink-100">Appearance</div>
            <a href="/settings#appearance" className="text-xs text-ink-400 hover:text-ink-100">All settings →</a>
          </div>
          <AppearancePanel compact />
        </div>
      )}
    </div>
  );
}
