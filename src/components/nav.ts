/** App navigation, grouped into sections. `desc` is shown in the sidebar tooltip and on the home page shortcuts. */
export interface NavItem {
  href: string;
  label: string;
  short: string;
  desc: string;
  icon: string;
}
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const I = {
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  live: "M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0M7.8 16.2a6 6 0 010-8.4M16.2 7.8a6 6 0 010 8.4M5 19a10 10 0 010-14M19 5a10 10 0 010 14",
  players: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  stats: "M4 20V10m6 10V4m6 16v-7m6 7H2",
  teams: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  matchups: "M4 6h7v12H4zM13 6h7v12h-7z",
  predictions: "M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z",
  plays: "M12 2l3 6.5 7 .9-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.9z",
  analyzer: "M11 4a7 7 0 105.2 11.7L21 20.5M8 11h6M11 8v6",
  parlay: "M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4",
  vault: "M4 5h16v14H4zM4 9h16M9 13h6",
  tracker: "M3 17l6-6 4 4 8-8M15 7h6v6",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.8 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 14H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 3.1V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 10h.1a2 2 0 110 4H21a1.7 1.7 0 00-1.6 1z",
  appearance: "M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.4-4-7.8-9-7.8zM7.5 12.5a1 1 0 100-2 1 1 0 000 2zM10.5 8.5a1 1 0 100-2 1 1 0 000 2zM15 8.5a1 1 0 100-2 1 1 0 000 2z",
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { href: "/", label: "Home Dashboard", short: "Home", desc: "Today's games, trends and model performance", icon: I.home },
      { href: "/live", label: "Live & Upcoming", short: "Live", desc: "Live scores and the next 7 days of games", icon: I.live },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      { href: "/players", label: "Player Research", short: "Players", desc: "Profiles, game logs, splits and injuries", icon: I.players },
      { href: "/stats", label: "Player Statistics", short: "Stats", desc: "Sortable league-wide stat tables", icon: I.stats },
      { href: "/teams", label: "Team Analytics", short: "Teams", desc: "Offensive and defensive rankings", icon: I.teams },
      { href: "/matchups", label: "Matchup Center", short: "Matchups", desc: "Game previews with both rosters and stats", icon: I.matchups },
    ],
  },
  {
    id: "ai",
    label: "AI Tools",
    items: [
      { href: "/predictions", label: "AI Predictions", short: "Forecasts", desc: "Hit probability for any player and line", icon: I.predictions },
      { href: "/plays", label: "Top Plays", short: "Plays", desc: "The model's strongest calls today", icon: I.plays },
      { href: "/analyzer", label: "Pick Analyzer", short: "Picks", desc: "Check player picks from a screenshot", icon: I.analyzer },
      { href: "/parlay", label: "Parlay Analyzer", short: "Parlay", desc: "Chance your whole parlay hits", icon: I.parlay },
    ],
  },
  {
    id: "mine",
    label: "My Research",
    items: [
      { href: "/vault", label: "Research Vault", short: "Vault", desc: "Saved reports, notes and screenshots", icon: I.vault },
      { href: "/tracker", label: "Performance Tracker", short: "Tracker", desc: "How your tracked forecasts turned out", icon: I.tracker },
    ],
  },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Settings", short: "Settings", desc: "Account, appearance and data sources", icon: I.settings };
export const APPEARANCE_ICON = I.appearance;

/** Flat list (kept for callers that don't need sections). */
export const NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_NAV];

/** The section a path belongs to, for page eyebrows. */
export function navGroupFor(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAV_GROUPS)
    for (const item of group.items) if (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")) return { group, item };
  return null;
}
