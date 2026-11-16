import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { NavIcon } from "./icons";
import { refreshData } from "@/router";

export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  live: "M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0M7.8 16.2a6 6 0 010-8.4M16.2 7.8a6 6 0 010 8.4M5 19a10 10 0 010-14M19 5a10 10 0 010 14",
  predict: "M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z",
  analyze: "M11 4a7 7 0 105.2 11.7L21 20.5M8 11h6M11 8v6",
  more: "M4 6h16M4 12h16M4 18h16",
  search: "M11 4a7 7 0 105.2 11.7L21 20.5",
  players: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  stats: "M4 20V10m6 10V4m6 16v-7m6 7H2",
  teams: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  matchups: "M4 6h7v12H4zM13 6h7v12h-7z",
  plays: "M12 2l3 6.5 7 .9-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.9z",
  parlay: "M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4",
  vault: "M4 5h16v14H4zM4 9h16M9 13h6",
  news: "M4 5h13v14H5a1 1 0 01-1-1zM17 9h3v9a1 1 0 01-1 1h-2M7 9h7M7 12h7M7 15h4",
  tracker: "M3 17l6-6 4 4 8-8M15 7h6v6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.4-1.4M5.6 18.4L7 17M17 17l1.4 1.4M5.6 5.6L7 7",
  chevron: "M9 6l6 6-6 6",
  download: "M12 4v12m0 0l-5-5m5 5l5-5M4 20h16",
  upload: "M12 20V8m0 0l-5 5m5-5l5 5M4 4h16",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01",
  phone: "M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2",
};

/** Section title with an optional action link. */
export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-2.5", className)}>
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        {action && <div className="shrink-0 text-xs">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Tappable list row: icon/leading, text, trailing chevron. */
export function ListRow({ href, onClick, leading, title, sub, trailing, chevron = true }: { href?: string; onClick?: () => void; leading?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; chevron?: boolean }) {
  const inner = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-ink-100">{title}</span>
        {sub && <span className="block truncate text-xs text-ink-400">{sub}</span>}
      </span>
      {trailing && <span className="shrink-0 text-right">{trailing}</span>}
      {chevron && <NavIcon d={ICONS.chevron} className="h-4 w-4 text-ink-500" />}
    </>
  );
  const cls = "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-ink-800";
  if (href) return <a href={href.startsWith("#") ? href : `#${href}`} className={cls}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("card divide-y divide-ink-800 overflow-hidden", className)}>{children}</div>;
}

export function Loading({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card card-pad text-center">
      <div className="text-sm font-semibold text-white">Couldn't load this</div>
      <p className="mt-1 text-xs text-ink-400">{message}</p>
      <button className="btn btn-primary mt-3" onClick={refreshData}>Try again</button>
    </div>
  );
}

/** iOS-style segmented control. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl border border-ink-700 bg-ink-900 p-1" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)} className={cx("flex-1 rounded-lg py-2 text-sm font-medium transition", value === o.id ? "bg-brand/20 text-white shadow-sm" : "text-ink-300")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Horizontally scrolling row of cards. */
export function Carousel({ children }: { children: ReactNode }) {
  return <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1">{children}</div>;
}

export function Disclaimer() {
  return (
    <p className="px-1 text-[11px] leading-relaxed text-ink-500">
      STATLINE provides sports statistics and analysis only — it does not accept, place or settle bets. Forecasts are probabilities, never guarantees. If you choose to bet, do so legally and responsibly (21+). Gambling problem? Call 1-800-GAMBLER.
    </p>
  );
}
