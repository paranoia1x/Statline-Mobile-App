const FORMAT_KEY = "sl.fantasyFormat";

export function readFantasyFormats(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FORMAT_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function saveFantasyFormats(formats: Record<string, string>): void {
  try {
    localStorage.setItem(FORMAT_KEY, JSON.stringify(formats));
  } catch {
    /* Storage can be unavailable in private mode. */
  }
}
