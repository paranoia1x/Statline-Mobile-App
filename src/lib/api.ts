/**
 * Local API: the desktop app's /api route handlers, run inside the app instead of on a server.
 * Components call apiFetch("/api/...") exactly where the desktop calls fetch("/api/...").
 */
import * as analyzerAnalyze from "@/api/analyzer/analyze/route";
import * as analyzerParse from "@/api/analyzer/parse/route";
import * as forecast from "@/api/forecast/route";
import * as linesImport from "@/api/lines/import/route";
import * as lines from "@/api/lines/route";
import * as live from "@/api/live/route";
import * as parlayAnalyze from "@/api/parlay/analyze/route";
import * as parlayParse from "@/api/parlay/parse/route";
import * as players from "@/api/players/route";
import * as predictionId from "@/api/predictions/[id]/route";
import * as predictionsGrade from "@/api/predictions/grade/route";
import * as predictions from "@/api/predictions/route";
import * as search from "@/api/search/route";
import * as settings from "@/api/settings/route";
import * as teams from "@/api/teams/route";
import * as uploadId from "@/api/uploads/[id]/route";
import * as uploads from "@/api/uploads/route";
import * as vaultId from "@/api/vault/[id]/route";
import * as vault from "@/api/vault/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>;

const ROUTES: [RegExp, RouteModule][] = [
  [/^\/api\/analyzer\/analyze$/, analyzerAnalyze as RouteModule],
  [/^\/api\/analyzer\/parse$/, analyzerParse as RouteModule],
  [/^\/api\/forecast$/, forecast as RouteModule],
  [/^\/api\/lines\/import$/, linesImport as RouteModule],
  [/^\/api\/lines$/, lines as RouteModule],
  [/^\/api\/live$/, live as RouteModule],
  [/^\/api\/parlay\/analyze$/, parlayAnalyze as RouteModule],
  [/^\/api\/parlay\/parse$/, parlayParse as RouteModule],
  [/^\/api\/players$/, players as RouteModule],
  [/^\/api\/predictions\/grade$/, predictionsGrade as RouteModule],
  [/^\/api\/predictions\/(?<id>[^/]+)$/, predictionId as RouteModule],
  [/^\/api\/predictions$/, predictions as RouteModule],
  [/^\/api\/search$/, search as RouteModule],
  [/^\/api\/settings$/, settings as RouteModule],
  [/^\/api\/teams$/, teams as RouteModule],
  [/^\/api\/uploads\/(?<id>[^/]+)$/, uploadId as RouteModule],
  [/^\/api\/uploads$/, uploads as RouteModule],
  [/^\/api\/vault\/(?<id>[^/]+)$/, vaultId as RouteModule],
  [/^\/api\/vault$/, vault as RouteModule],
];

const ORIGIN = "https://statline.local";

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, ORIGIN);
  const method = (init?.method ?? "GET").toUpperCase() as keyof RouteModule;
  for (const [re, mod] of ROUTES) {
    const m = re.exec(url.pathname);
    if (!m) continue;
    const fn = mod[method];
    if (!fn) return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    try {
      return await fn(new Request(url, init), { params: Promise.resolve({ ...(m.groups ?? {}) }) });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: (e as Error).message || "Something went wrong" }), { status: 500 });
    }
  }
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
}
