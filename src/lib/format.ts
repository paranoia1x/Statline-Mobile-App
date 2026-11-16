export const pct = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}
export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " UTC";
}
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }) + " UTC";
}
export function relDay(iso: string, now: Date) {
  const d = Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(now.toISOString().slice(0, 10))) / 86_400_000);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
