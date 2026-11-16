import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { match, navigate, useLocation } from "@/router";
import { provider } from "@/boot";
import { useOnline, useSport } from "@/hooks";
import { cx } from "@/lib/format";
import { SPORTS } from "@/lib/sports";
import { SPORT_IDS, type SportId } from "@/lib/types";
import { NavIcon } from "@/components/icons";
import { AppearanceButton } from "@/components/AppearancePicker";
import { Wordmark } from "@/components/Wordmark";
import { ICONS } from "@/components/mobile";

const Home = lazy(() => import("@/pages/Home"));
const Live = lazy(() => import("@/pages/Live"));
const Predict = lazy(() => import("@/pages/Predict"));
const Analyze = lazy(() => import("@/pages/Analyze"));
const More = lazy(() => import("@/pages/More"));
const Plays = lazy(() => import("@/pages/Plays"));
const Players = lazy(() => import("@/pages/Players"));
const PlayerPage = lazy(() => import("@/pages/PlayerPage"));
const Teams = lazy(() => import("@/pages/Teams"));
const TeamPage = lazy(() => import("@/pages/TeamPage"));
const Matchups = lazy(() => import("@/pages/Matchups"));
const MatchupPage = lazy(() => import("@/pages/MatchupPage"));
const Stats = lazy(() => import("@/pages/Stats"));
const Vault = lazy(() => import("@/pages/Vault"));
const Tracker = lazy(() => import("@/pages/Tracker"));
const Settings = lazy(() => import("@/pages/Settings"));
const Search = lazy(() => import("@/pages/Search"));
const News = lazy(() => import("@/pages/News"));

type Tab = "home" | "live" | "predict" | "analyze" | "more";
interface Screen {
  pattern: string;
  tab: Tab;
  title?: string; // undefined => root tab (brand header)
  sportBar?: boolean;
  render: (p: Record<string, string>, q: URLSearchParams) => ReactNode;
}

const SCREENS: Screen[] = [
  { pattern: "/", tab: "home", sportBar: true, render: () => <Home /> },
  { pattern: "/live", tab: "live", sportBar: true, render: () => <Live /> },
  { pattern: "/predictions", tab: "predict", sportBar: true, render: (_p, q) => <Predict query={q} /> },
  { pattern: "/analyze", tab: "analyze", render: (_p, q) => <Analyze tab={q.get("tab") === "parlay" ? "parlay" : "picks"} /> },
  { pattern: "/analyzer", tab: "analyze", render: () => <Analyze tab="picks" /> },
  { pattern: "/parlay", tab: "analyze", render: () => <Analyze tab="parlay" /> },
  { pattern: "/more", tab: "more", render: () => <More /> },
  { pattern: "/plays", tab: "home", title: "Top Plays", sportBar: true, render: () => <Plays /> },
  { pattern: "/players", tab: "more", title: "Players", sportBar: true, render: (_p, q) => <Players query={q} /> },
  { pattern: "/players/:id", tab: "more", title: "Player", render: (p) => <PlayerPage id={p.id} /> },
  { pattern: "/teams", tab: "more", title: "Teams", sportBar: true, render: () => <Teams /> },
  { pattern: "/teams/:id", tab: "more", title: "Team", render: (p) => <TeamPage id={p.id} /> },
  { pattern: "/matchups", tab: "live", title: "Matchups", sportBar: true, render: () => <Matchups /> },
  { pattern: "/matchups/:id", tab: "live", title: "Matchup", render: (p) => <MatchupPage id={p.id} /> },
  { pattern: "/stats", tab: "more", title: "Player Stats", sportBar: true, render: (_p, q) => <Stats query={q} /> },
  { pattern: "/vault", tab: "more", title: "Research Vault", render: (_p, q) => <Vault openId={q.get("open") ?? undefined} /> },
  { pattern: "/tracker", tab: "more", title: "Performance Tracker", render: () => <Tracker /> },
  { pattern: "/settings", tab: "more", title: "Settings", render: () => <Settings /> },
  { pattern: "/news", tab: "home", title: "Sports News", sportBar: true, render: () => <News /> },
  { pattern: "/search", tab: "home", title: "Search", render: (_p, q) => <Search initial={q.get("q") ?? ""} /> },
];

const TABS: { id: Tab; href: string; label: string; icon: string }[] = [
  { id: "home", href: "/", label: "Home", icon: ICONS.home },
  { id: "live", href: "/live", label: "Live", icon: ICONS.live },
  { id: "predict", href: "/predictions", label: "Predict", icon: ICONS.predict },
  { id: "analyze", href: "/analyze", label: "Analyze", icon: ICONS.analyze },
  { id: "more", href: "/more", label: "More", icon: ICONS.more },
];

function resolve(path: string) {
  for (const s of SCREENS) {
    const p = match(s.pattern, path);
    if (p) return { screen: s, params: p };
  }
  return null;
}

function SportBar() {
  const [sport, setSport] = useSport();
  const items: (SportId | null)[] = [null, ...SPORT_IDS];
  return (
    <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2.5" role="tablist" aria-label="Sport filter">
      {items.map((s) => (
        <button key={s ?? "all"} role="tab" aria-selected={sport === s} onClick={() => setSport(s)} className={cx("chip shrink-0 px-3.5 py-1.5", sport === s && "chip-active")}>
          {s ? (s === "soccer" ? "Soccer" : SPORTS[s].name.split(" ")[0]) : "All"}
        </button>
      ))}
    </div>
  );
}

/** Thin progress bar while a sport's stats download (first launch or after an update). */
function LoadBar() {
  const [busy, setBusy] = useState<string[]>([]);
  useEffect(
    () =>
      provider.onLoad((s, phase) =>
        setBusy((b) => (phase === "loading" ? [...new Set([...b, s])] : b.filter((x) => x !== s))),
      ),
    [],
  );
  if (!busy.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50" role="status" aria-live="polite">
      <div className="h-0.5 w-full overflow-hidden bg-transparent">
        <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] rounded-full bg-brand-bright" />
      </div>
      <span className="sr-only">Loading {busy.map((s) => s.toUpperCase()).join(", ")} stats</span>
    </div>
  );
}

export function App() {
  const loc = useLocation();
  const online = useOnline();
  const hit = resolve(loc.path);
  const screen = hit?.screen;
  // scroll to top on navigation
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.path]);

  return (
    <div className="min-h-[100dvh]">
      <LoadBar />
      <header className="sticky top-0 z-30 border-b border-ink-800/80 bg-ink-950/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="flex h-14 items-center gap-2 px-4">
          {screen?.title ? (
            <>
              <button className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-ink-200 active:bg-ink-800" onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/"))} aria-label="Back">
                <NavIcon d="M15 18l-6-6 6-6" className="h-6 w-6" />
              </button>
              <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-white">{screen.title}</h1>
            </>
          ) : (
            <a href="#/" className="flex min-w-0 flex-1 items-center gap-2.5" aria-label="STATLINE home">
              <img src={`${import.meta.env.BASE_URL}icons/icon-180.png`} alt="" width={32} height={32} className="h-8 w-8 rounded-lg shadow-[0_0_14px_rgb(var(--brand)/0.45)]" />
              <Wordmark size="md" />
            </a>
          )}
          <a href="#/search" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-200 active:bg-ink-800" aria-label="Search">
            <NavIcon d={ICONS.search} className="h-5 w-5" />
          </a>
          <AppearanceButton />
        </div>
        {screen?.sportBar && (
          <div className="px-4">
            <SportBar />
          </div>
        )}
        {!online && <div className="bg-warn/15 px-4 py-1 text-center text-[11px] font-medium text-warn">Offline — showing saved stats</div>}
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-[calc(84px+env(safe-area-inset-bottom))] pt-4">
        <Suspense fallback={<PageSkeleton />}>{screen ? screen.render(hit!.params, loc.query) : <NotFound />}</Suspense>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md" aria-label="Main">
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((t) => {
            const on = screen?.tab === t.id;
            return (
              <a key={t.id} href={`#${t.href}`} aria-current={on ? "page" : undefined} className={cx("flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[10.5px] font-medium transition-colors", on ? "text-brand-bright" : "text-ink-400 active:text-ink-200")}>
                <span className={cx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", on && "bg-brand/15")}>
                  <NavIcon d={t.icon} className="h-[22px] w-[22px]" />
                </span>
                {t.label}
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="skeleton h-24 w-full rounded-xl" />
      <div className="skeleton h-40 w-full rounded-xl" />
      <div className="skeleton h-40 w-full rounded-xl" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <div className="text-lg font-semibold text-white">Page not found</div>
      <a href="#/" className="btn btn-primary mt-4">Go home</a>
    </div>
  );
}
