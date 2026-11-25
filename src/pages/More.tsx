import { ICONS, ListCard, ListRow } from "@/components/mobile";
import { NavIcon } from "@/components/icons";

const GROUPS: { label: string; items: { href: string; label: string; sub: string; icon: string }[] }[] = [
  {
    label: "Research",
    items: [
      { href: "/news", label: "Sports News", sub: "Latest headlines and injury updates", icon: ICONS.news },
      { href: "/players", label: "Player Research", sub: "Profiles, game logs, splits, injuries", icon: ICONS.players },
      { href: "/stats", label: "Player Statistics", sub: "League-wide stat leaders", icon: ICONS.stats },
      { href: "/teams", label: "Team Analytics", sub: "Offensive & defensive rankings", icon: ICONS.teams },
      { href: "/matchups", label: "Matchup Center", sub: "Previews with both rosters", icon: ICONS.matchups },
    ],
  },
  {
    label: "AI Tools",
    items: [
      { href: "/fantasy", label: "Fantasy", sub: "Projected fantasy points, matchups, start/sit", icon: ICONS.fantasy },
      { href: "/predictions", label: "AI Predictions", sub: "Hit chance for any player and line", icon: ICONS.predict },
      { href: "/plays", label: "Top Plays", sub: "The model's strongest calls", icon: ICONS.plays },
      { href: "/analyzer", label: "Pick Analyzer", sub: "Check picks from a screenshot", icon: ICONS.analyze },
      { href: "/parlay", label: "Parlay Analyzer", sub: "Chance your whole parlay hits", icon: ICONS.parlay },
    ],
  },
  {
    label: "My Research",
    items: [
      { href: "/vault", label: "Research Vault", sub: "Saved reports, notes, screenshots", icon: ICONS.vault },
      { href: "/tracker", label: "Performance Tracker", sub: "How your tracked forecasts did", icon: ICONS.tracker },
    ],
  },
  {
    label: "App",
    items: [{ href: "/settings", label: "Settings", sub: "Appearance, backup, install, about", icon: ICONS.settings }],
  },
];

export default function More() {
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <section key={g.label}>
          <div className="label mb-2 px-1">{g.label}</div>
          <ListCard>
            {g.items.map((i) => (
              <ListRow
                key={i.href}
                href={i.href}
                leading={
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand-bright">
                    <NavIcon d={i.icon} className="h-5 w-5" />
                  </span>
                }
                title={i.label}
                sub={i.sub}
              />
            ))}
          </ListCard>
        </section>
      ))}
      <p className="text-center text-[11px] font-semibold uppercase italic tracking-[0.3em] text-brand-bright/80">Track • Analyze • Win</p>
    </div>
  );
}
