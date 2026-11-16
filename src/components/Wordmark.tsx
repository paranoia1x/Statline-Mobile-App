import { cx } from "@/lib/format";

/** STATLINE wordmark: white "STAT", purple "LINE", heavy italic with a swoosh underline. */
export function Wordmark({ size = "md", underline = false, className }: { size?: "sm" | "md" | "lg" | "xl"; underline?: boolean; className?: string }) {
  const text = { sm: "text-base", md: "text-lg", lg: "text-3xl sm:text-4xl", xl: "text-5xl sm:text-6xl" }[size];
  return (
    <span className={cx("inline-flex flex-col", className)}>
      <span className={cx("font-black italic uppercase leading-none tracking-tight", text)} style={{ letterSpacing: "-0.02em" }} aria-label="STATLINE">
        <span className="text-white">STAT</span>
        <span className="text-brand-bright">LINE</span>
      </span>
      {underline && <span className="mt-1.5 h-[3px] w-full rounded-full bg-gradient-to-r from-brand-deep via-brand-bright to-transparent" aria-hidden />}
    </span>
  );
}

export function Slogan({ text, className }: { text: string; className?: string }) {
  return <span className={cx("text-[11px] font-semibold uppercase italic tracking-[0.35em] text-ink-300", className)}>{text}</span>;
}
