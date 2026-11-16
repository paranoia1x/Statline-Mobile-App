import { navigate, refreshData, useLocation } from "@/router";

/** next/navigation stand-ins backed by the hash router. */
export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    refresh: () => refreshData(),
    back: () => window.history.back(),
  };
}
export const usePathname = () => useLocation().path;
export const useSearchParams = () => useLocation().query;
