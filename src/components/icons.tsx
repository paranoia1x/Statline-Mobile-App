import { cx } from "@/lib/format";

/** Stroke icon from a single SVG path (24×24 grid). */
export function NavIcon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("h-4 w-4 shrink-0", className)} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
