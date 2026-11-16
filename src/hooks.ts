import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DependencyList } from "react";
import { SPORT_IDS, type SportId } from "@/lib/types";
import { subscribeStore } from "@/lib/store";

/** Runs an async loader; re-runs when deps change, when data is refreshed, or when the store changes. */
export function useData<T>(loader: () => Promise<T>, deps: DependencyList, opts: { watchStore?: boolean } = {}) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("app-refresh", bump);
    const unsub = opts.watchStore ? subscribeStore(bump) : undefined;
    return () => {
      window.removeEventListener("app-refresh", bump);
      unsub?.();
    };
  }, [opts.watchStore]);
  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader().then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (e) => id === seq.current && setState((s) => ({ ...s, error: (e as Error).message || "Something went wrong", loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return state;
}

// ---------------- sport filter (persisted) ----------------
const SPORT_KEY = "sl.sport";
const sportSubscribe = (fn: () => void) => {
  window.addEventListener("sport-change", fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener("sport-change", fn);
    window.removeEventListener("storage", fn);
  };
};
const readSport = () => {
  try {
    return localStorage.getItem(SPORT_KEY) ?? "";
  } catch {
    return "";
  }
};

export function useSport(): [SportId | null, (s: SportId | null) => void] {
  const raw = useSyncExternalStore(sportSubscribe, readSport, () => "");
  const sport = (SPORT_IDS as string[]).includes(raw) ? (raw as SportId) : null;
  const set = useCallback((s: SportId | null) => {
    try {
      localStorage.setItem(SPORT_KEY, s ?? "");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("sport-change"));
  }, []);
  return [sport, set];
}

/** Online/offline status. */
export function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("online", fn);
      window.addEventListener("offline", fn);
      return () => {
        window.removeEventListener("online", fn);
        window.removeEventListener("offline", fn);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
