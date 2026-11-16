import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import type { AvailabilityStatus } from "@/lib/types";

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx("card", pad && "card-pad", className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = "neutral" | "pos" | "neg" | "ai" | "warn" | "blue";
const TONES: Record<Tone, string> = {
  neutral: "border-ink-600 bg-ink-800 text-ink-200",
  pos: "border-pos/30 bg-pos/10 text-pos",
  neg: "border-neg/30 bg-neg/10 text-neg",
  ai: "border-ai/40 bg-ai/10 text-brand-light",
  warn: "border-warn/30 bg-warn/10 text-warn",
  blue: "border-ai-blue/40 bg-ai-blue/10 text-info",
};

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="warn" title="Synthetic demo data — not real statistics">
      DEMO DATA
    </Badge>
  );
}

const STATUS_TONE: Record<AvailabilityStatus, Tone> = { active: "pos", "day-to-day": "blue", questionable: "warn", doubtful: "warn", out: "neg" };
export function AvailabilityBadge({
  status,
  description,
  seasonEnding,
  returns,
}: {
  status: AvailabilityStatus;
  description?: string;
  /** Out for the rest of the season. */
  seasonEnding?: boolean;
  /** Expected return date (ISO), shown for players listed out. */
  returns?: string | null;
}) {
  const icon = status === "out" ? "✕" : status === "active" ? "●" : "!";
  const back = status === "out" && !seasonEnding && returns ? new Date(returns).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  return (
    <Badge tone={STATUS_TONE[status]} title={[description, back && `Expected back around ${back}`].filter(Boolean).join(" · ")}>
      <span aria-hidden>{icon}</span>
      {seasonEnding ? "Out for season" : status === "active" ? "Available" : status.replace(/^\w/, (c) => c.toUpperCase())}
      {back && <span className="opacity-80">· back ~{back}</span>}
    </Badge>
  );
}

export function ConfidencePill({ level, score }: { level: "low" | "medium" | "high"; score?: number }) {
  const tone: Tone = level === "high" ? "ai" : level === "medium" ? "blue" : "neutral";
  return (
    <Badge tone={tone} title={score != null ? `Confidence score ${score}/100 — reliability of the estimate, not certainty of the outcome` : undefined}>
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx("h-2 w-1 rounded-sm", i <= (level === "high" ? 2 : level === "medium" ? 1 : 0) ? "bg-current" : "bg-current opacity-25")} />
        ))}
      </span>
      {level[0].toUpperCase() + level.slice(1)} confidence
    </Badge>
  );
}

export function KPI({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | "ai" }) {
  return (
    <div className="rounded-lg border border-ink-700/70 bg-ink-850 px-4 py-3">
      <div className="label">{label}</div>
      <div className={cx("num mt-1 text-2xl font-semibold", tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "ai" ? "text-brand-light" : "text-white")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-700 px-6 py-10 text-center">
      <div className="mb-2 h-8 w-8 rounded-full border border-ink-600 bg-ink-850" aria-hidden />
      <div className="text-sm font-medium text-ink-100">{title}</div>
      {body && <div className="mt-1 max-w-md text-xs text-ink-400">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function MissingData({ children = "Not available" }: { children?: ReactNode }) {
  return (
    <span className="text-ink-500" title="Missing data — not available from the current data source">
      {children}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-neg/30 bg-neg/10 px-3 py-2 text-sm text-neg">{children}</div>;
}

export function Warning({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"><span aria-hidden>!</span><div>{children}</div></div>;
}

export function ProbabilityBar({ pOver, pUnder, pPush = 0, threshold }: { pOver: number; pUnder: number; pPush?: number; threshold: number | string }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-ink-300">
          Above {threshold} <span className="num ml-1 font-semibold text-pos">{(pOver * 100).toFixed(1)}%</span>
        </span>
        <span className="text-ink-300">
          <span className="num mr-1 font-semibold text-neg">{(pUnder * 100).toFixed(1)}%</span> Below {threshold}
        </span>
      </div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-ink-800">
        <div className="h-full rounded-l-full bg-pos" style={{ width: `${pOver * 100}%` }} />
        {pPush > 0.001 && <div className="h-full bg-ink-500" style={{ width: `${pPush * 100}%` }} title={`Exactly ${threshold}: ${(pPush * 100).toFixed(1)}%`} />}
        <div className="h-full flex-1 rounded-r-full bg-neg" />
      </div>
    </div>
  );
}

export function PercentileBar({ percentile, higherIsBetter = true }: { percentile: number | null; higherIsBetter?: boolean }) {
  if (percentile == null) return <MissingData>—</MissingData>;
  void higherIsBetter;
  const tone = percentile >= 67 ? "bg-pos" : percentile <= 33 ? "bg-neg" : "bg-ink-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-800">
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${Math.max(4, percentile)}%` }} />
      </div>
      <span className="num w-8 text-right text-xs text-ink-300">{percentile}</span>
    </div>
  );
}

export function SportTag({ sport }: { sport: string }) {
  return <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-300">{sport}</span>;
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx("link", className)}>
      {children}
    </Link>
  );
}

export function AiCallout({ title = "AI insight", children, source }: { title?: string; children: ReactNode; source?: "claude" | "template" }) {
  return (
    <div className="rounded-lg border border-ai/30 bg-ai/[0.06] p-4">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-brand-light">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ai" aria-hidden />
        {title}
        {source && <span className="font-normal text-ink-400">· {source === "claude" ? "written by Claude from computed statistics" : "generated from computed statistics"}</span>}
      </div>
      <div className="text-sm leading-relaxed text-ink-200">{children}</div>
    </div>
  );
}

export function VerdictBadge({ label, pct, side, sideWords = ["Above", "Below"] }: { label: string; pct?: number; side?: "over" | "under" | null; sideWords?: [string, string] }) {
  const tone: Tone = label.endsWith("hit") ? "pos" : label.endsWith("miss") ? "neg" : "neutral";
  return (
    <Badge tone={tone} title="AI verdict: calibrated probability, downgraded when confidence is low">
      {side ? `${side === "over" ? sideWords[0] : sideWords[1]}: ` : ""}
      {label}
      {pct != null && <span className="num opacity-80"> {Math.round(pct * 100)}%</span>}
    </Badge>
  );
}
