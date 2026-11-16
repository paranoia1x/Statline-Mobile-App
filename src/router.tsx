/**
 * Tiny hash router (#/path?query). Hash URLs work on GitHub Pages without server rewrites
 * and keep working offline from the home-screen app.
 */
import { useSyncExternalStore } from "react";

const subscribe = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const snapshot = () => window.location.hash;

export interface Loc {
  path: string;
  query: URLSearchParams;
  href: string;
}

export function parseHash(hash: string): Loc {
  const raw = hash.replace(/^#/, "") || "/";
  const [p, q = ""] = raw.split("?");
  const path = p.startsWith("/") ? p : "/" + p;
  return { path, query: new URLSearchParams(q), href: path + (q ? `?${q}` : "") };
}

export function useLocation(): Loc {
  const h = useSyncExternalStore(subscribe, snapshot, () => "");
  return parseHash(h);
}

/** "/players?x=1" -> "#/players?x=1" (external and hash links pass through). */
export function toHref(href: string) {
  if (/^(https?:|mailto:|tel:|#)/.test(href)) return href;
  return "#" + (href.startsWith("/") ? href : "/" + href);
}

export function navigate(href: string, opts: { replace?: boolean } = {}) {
  const target = toHref(href);
  if (opts.replace) {
    window.history.replaceState(window.history.state, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else window.location.hash = target.slice(1);
}

/** Matches "/players/:id" against a path; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split("/").filter(Boolean);
  const xs = path.split("/").filter(Boolean);
  if (ps.length !== xs.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(":")) out[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return out;
}

/** Ask the current screen to reload its data (the desktop's router.refresh()). */
export function refreshData() {
  window.dispatchEvent(new Event("app-refresh"));
}
