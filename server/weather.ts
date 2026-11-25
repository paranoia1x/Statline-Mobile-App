/**
 * Game-time weather for outdoor NFL stadiums, from Open-Meteo (https://open-meteo.com):
 * free, no API key, open data (non-commercial use). Used by the data job only; the phone
 * reads the result from the snapshot.
 *
 * Only an allow-listed host is requested; the response is parsed as JSON and only numbers
 * are kept. If the service can't be reached, games keep ESPN's own temperature/conditions.
 */
import type { Game, GameWeather, Team } from "@/lib/types";

const HOST = "api.open-meteo.com";

/** Home stadium coordinates by ESPN team abbreviation (domes included so neutral-site checks work). */
export const NFL_STADIUMS: Record<string, { lat: number; lon: number; venue: RegExp }> = {
  ARI: { lat: 33.5276, lon: -112.2626, venue: /State Farm/i },
  ATL: { lat: 33.7554, lon: -84.4008, venue: /Mercedes/i },
  BAL: { lat: 39.278, lon: -76.6227, venue: /M&T/i },
  BUF: { lat: 42.7738, lon: -78.787, venue: /Highmark|Bills/i },
  CAR: { lat: 35.2258, lon: -80.8528, venue: /Bank of America/i },
  CHI: { lat: 41.8623, lon: -87.6167, venue: /Soldier/i },
  CIN: { lat: 39.0954, lon: -84.516, venue: /Paycor|Paul Brown/i },
  CLE: { lat: 41.5061, lon: -81.6995, venue: /Huntington|Cleveland Browns/i },
  DAL: { lat: 32.7473, lon: -97.0945, venue: /AT&T/i },
  DEN: { lat: 39.7439, lon: -105.0201, venue: /Empower|Mile High/i },
  DET: { lat: 42.34, lon: -83.0456, venue: /Ford Field/i },
  GB: { lat: 44.5013, lon: -88.0622, venue: /Lambeau/i },
  HOU: { lat: 29.6847, lon: -95.4107, venue: /NRG|Reliant/i },
  IND: { lat: 39.7601, lon: -86.1639, venue: /Lucas Oil/i },
  JAX: { lat: 30.3239, lon: -81.6373, venue: /EverBank|TIAA|Jacksonville/i },
  KC: { lat: 39.0489, lon: -94.4839, venue: /Arrowhead|GEHA/i },
  LV: { lat: 36.0909, lon: -115.1833, venue: /Allegiant/i },
  LAC: { lat: 33.9535, lon: -118.3392, venue: /SoFi/i },
  LAR: { lat: 33.9535, lon: -118.3392, venue: /SoFi/i },
  MIA: { lat: 25.958, lon: -80.2389, venue: /Hard Rock/i },
  MIN: { lat: 44.9737, lon: -93.2581, venue: /U\.?S\.? Bank/i },
  NE: { lat: 42.0909, lon: -71.2643, venue: /Gillette/i },
  NO: { lat: 29.9511, lon: -90.0812, venue: /Superdome/i },
  NYG: { lat: 40.8135, lon: -74.0745, venue: /MetLife/i },
  NYJ: { lat: 40.8135, lon: -74.0745, venue: /MetLife/i },
  PHI: { lat: 39.9008, lon: -75.1675, venue: /Lincoln/i },
  PIT: { lat: 40.4468, lon: -80.0158, venue: /Acrisure|Heinz/i },
  SF: { lat: 37.403, lon: -121.97, venue: /Levi/i },
  SEA: { lat: 47.5952, lon: -122.3316, venue: /Lumen/i },
  TB: { lat: 27.9759, lon: -82.5033, venue: /Raymond James/i },
  TEN: { lat: 36.1665, lon: -86.7713, venue: /Nissan/i },
  WSH: { lat: 38.9077, lon: -76.8645, venue: /Northwest|FedEx/i },
};

const HOUR = 3600_000;
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Adds Open-Meteo wind/precipitation/temperature (averaged over the first three hours of the game)
 * to upcoming outdoor NFL games within the 16-day forecast range. Mutates and returns `games`.
 */
export async function addNflWeather(games: Game[], teams: Team[], now: Date): Promise<{ updated: number; error?: string }> {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const targets = games.filter((g) => {
    if (g.status !== "scheduled" || g.indoor) return false;
    const t = Date.parse(g.date) - now.getTime();
    if (t < -4 * HOUR || t > 15 * 24 * HOUR) return false;
    const st = NFL_STADIUMS[byId.get(g.homeTeamId)?.abbreviation ?? ""];
    return !!st && (!g.venue || st.venue.test(g.venue)); // neutral/international sites: keep ESPN's weather
  });
  if (!targets.length) return { updated: 0 };
  const locs = targets.map((g) => NFL_STADIUMS[byId.get(g.homeTeamId)!.abbreviation]);
  const url = new URL(`https://${HOST}/v1/forecast`);
  url.searchParams.set("latitude", locs.map((l) => l.lat).join(","));
  url.searchParams.set("longitude", locs.map((l) => l.lon).join(","));
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("forecast_days", "16");
  let body: any;
  try {
    if (url.hostname !== HOST || url.protocol !== "https:") throw new Error("host not allowed");
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > 4_000_000) throw new Error("response too large");
    body = JSON.parse(text);
  } catch (e) {
    return { updated: 0, error: (e as Error).message };
  }
  const list: any[] = Array.isArray(body) ? body : [body];
  let updated = 0;
  targets.forEach((g, i) => {
    const w = parseHourly(list[i]?.hourly, Date.parse(g.date));
    if (!w) return;
    g.weather = { ...w, condition: g.weather?.condition ?? "", source: "Open-Meteo" };
    updated++;
  });
  return { updated };
}

/** Mean of the hourly values covering kick-off to +3 h. */
export function parseHourly(h: any, kickoff: number): Omit<GameWeather, "condition" | "source"> | null {
  if (!h || !Array.isArray(h.time)) return null;
  const idx: number[] = [];
  h.time.forEach((t: unknown, i: number) => {
    const ms = Date.parse(String(t) + "Z");
    if (ms >= kickoff - HOUR / 2 && ms < kickoff + 3 * HOUR) idx.push(i);
  });
  if (!idx.length) return null;
  const avg = (arr: unknown, k = 1) => {
    if (!Array.isArray(arr)) return null;
    const v = idx.map((i) => Number(arr[i])).filter((x) => Number.isFinite(x));
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * k) / k : null;
  };
  const wind = avg(h.wind_speed_10m);
  const gust = avg(h.wind_gusts_10m);
  return {
    temperatureF: avg(h.temperature_2m),
    // sustained wind, nudged toward gusts (gusts drive most of the effect on passing and kicking)
    windMph: wind == null ? null : Math.round(gust == null ? wind : wind * 0.75 + gust * 0.25),
    precipChance: avg(h.precipitation_probability),
  };
}
