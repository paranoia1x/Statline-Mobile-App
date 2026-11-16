/**
 * The mobile app has no accounts: everything belongs to the person holding the phone and is
 * stored on the device (see src/lib/store). This keeps the desktop route handlers unchanged.
 */
import type { SportId } from "@/lib/types";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  settings: { defaultSport?: SportId | "all" };
}

export const LOCAL_USER: PublicUser = { id: "local", email: "", name: "You", settings: {} };

export async function getCurrentUser(): Promise<PublicUser> {
  let sport: string | null = null;
  try {
    sport = localStorage.getItem("sl.sport");
  } catch {
    /* ignore */
  }
  return { ...LOCAL_USER, settings: { defaultSport: (sport as SportId) || "all" } };
}
