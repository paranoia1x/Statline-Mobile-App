/** Minimal stand-in for next/server so the desktop API route handlers run inside the app. */
export class NextResponse extends Response {
  readonly cookies = {
    set: (name: string, value: string) => {
      try {
        localStorage.setItem(`cookie.${name}`, value);
      } catch {
        /* ignore */
      }
    },
  };
  static json(data: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    return new NextResponse(JSON.stringify(data), { ...init, headers });
  }
}
