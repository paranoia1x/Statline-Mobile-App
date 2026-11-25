/**
 * ESPN data provider.
 *
 * Uses ESPN's public (unofficial, undocumented) JSON API. It is suitable for
 * personal research and prototyping; ESPN's terms of use restrict commercial
 * use, so a licensed feed should replace it before a commercial launch.
 *
 * Data flow per sport:
 *   teams + rosters + injuries + team schedules (current & previous season)
 *   + daily scoreboards for the next ~10 days            -> fast "base" load
 *   game summaries for recent completed games (box scores) -> background sync,
 *     cached permanently on disk; team and player game logs are derived from them.
 */
import type { SportsDataProvider, GameFilter } from "@/lib/data/provider";
import type { Game, Injury, LiveGame, Player, PlayerGameLog, SportId, Team, TeamGameLog, AvailabilityStatus } from "@/lib/types";
import { SPORT_IDS } from "@/lib/types";
import { registerImage } from "@/lib/images/registry";
import { setSportLabels } from "@/lib/sports";
import { espnJson, readBox, writeBox } from "./client";
import { COMPACT_GAME_VERSION, parseSummary, type CompactGame } from "./parse";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const PATHS: Record<SportId, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  soccer: `soccer/${process.env.ESPN_SOCCER_LEAGUE || "eng.1"}`,
};
const GAMES_PER_TEAM = Math.max(5, Number(process.env.ESPN_GAMES_PER_TEAM || 25));
const UPCOMING_DAYS = 10;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Statistics ESPN's box scores do not provide (shown as missing, excluded from forecasting). */
export const ESPN_UNSUPPORTED: Record<SportId, string[]> = {
  nba: ["usg"],
  nfl: [],
  mlb: ["tb"],
  nhl: [],
  soccer: ["xg", "passAtt", "tackles", "passPct"],
};

function positionGroup(sport: SportId, pos: string): string | null {
  const p = pos.toUpperCase();
  switch (sport) {
    case "nba":
      return p.startsWith("C") ? "C" : p.includes("F") ? "F" : p.includes("G") ? "G" : null;
    case "nfl":
      return p === "QB" ? "QB" : p === "RB" || p === "FB" ? "RB" : p === "WR" ? "WR" : p === "TE" ? "TE" : p === "PK" || p === "K" ? "K" : null;
    case "mlb":
      return p === "SP" || p === "RP" || p === "P" ? "SP" : "H";
    case "nhl":
      return p === "G" ? "G" : p === "D" ? "D" : "F";
    case "soccer":
      return p.startsWith("G") ? "GK" : p.startsWith("D") ? "DF" : p.startsWith("M") ? "MF" : p.startsWith("F") ? "FW" : null;
  }
}

/** Keep only the fields this app reads from schedule/scoreboard events (keeps the disk cache small). */
const slimEvents = (j: any) => ({
  season: j?.season ? { year: j.season.year } : undefined,
  requestedSeason: j?.requestedSeason ? { year: j.requestedSeason.year } : undefined,
  events: (j?.events ?? []).map((e: any) => ({
    id: e.id,
    date: e.date,
    season: e.season ? { year: e.season.year } : undefined,
    weather: e.weather ? { displayValue: e.weather.displayValue, temperature: e.weather.temperature, conditionId: e.weather.conditionId } : undefined,
    competitions: (e.competitions ?? []).slice(0, 1).map((c: any) => ({
      status: {
        type: { name: c.status?.type?.name, completed: c.status?.type?.completed, state: c.status?.type?.state, shortDetail: c.status?.type?.shortDetail },
        period: c.status?.period,
        displayClock: c.status?.displayClock,
      },
      venue: c.venue ? { fullName: c.venue.fullName, indoor: c.venue.indoor, address: c.venue.address ? { city: c.venue.address.city, state: c.venue.address.state } : undefined } : undefined,
      neutralSite: c.neutralSite,
      odds: (c.odds ?? []).slice(0, 1).map((o: any) => ({
        spread: o.spread, overUnder: o.overUnder,
        homeMl: o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds, awayMl: o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds,
      })),
      competitors: (c.competitors ?? []).map((x: any) => ({ homeAway: x.homeAway, id: x.id, team: { id: x.team?.id }, score: x.score })),
    })),
  })),
});
const slimRoster = (j: any) => {
  const one = (a: any) => ({
    id: a.id, fullName: a.fullName, displayName: a.displayName, firstName: a.firstName, lastName: a.lastName, jersey: a.jersey, age: a.age,
    position: { abbreviation: a.position?.abbreviation }, headshot: a.headshot?.href ? { href: a.headshot.href } : undefined,
  });
  return { athletes: (j?.athletes ?? []).map((a: any) => (Array.isArray(a.items) ? { items: a.items.map(one) } : one(a))) };
};

function seasonLabel(sport: SportId, year: number) {
  const yy = (n: number) => String(n).slice(2);
  if (sport === "nba" || sport === "nhl") return `${year - 1}-${yy(year)}`;
  if (sport === "soccer") return `${year}-${yy(year + 1)}`;
  return String(year);
}

const injuryStatus = (s: string): AvailabilityStatus => {
  const x = s.toLowerCase();
  if (x.includes("day")) return "day-to-day";
  if (x.includes("question")) return "questionable";
  if (x.includes("doubt")) return "doubtful";
  return "out"; // Out, Injured Reserve, IL, Suspension…
};
const SEASON_ENDING = /out for (the )?(rest of the )?season|season[- ]ending|miss the (rest of the |remainder of the )?season/i;

const numOrNull = (v: unknown) => {
  const x = typeof v === "string" ? Number(v.replace(/^[ou+]/i, "")) : Number(v);
  return v == null || v === "" || !Number.isFinite(x) ? null : x;
};
/** Betting line, weather and roof from a scoreboard/schedule event (whatever ESPN publishes for it). */
function gameExtras(e: any, c: any): Partial<Game> {
  const out: Partial<Game> = {};
  const o = c.odds?.[0];
  if (o) {
    const odds = { spread: numOrNull(o.spread), total: numOrNull(o.overUnder), homeMl: numOrNull(o.homeMl), awayMl: numOrNull(o.awayMl) };
    if (odds.spread != null || odds.total != null || odds.homeMl != null) out.odds = odds;
  }
  if (typeof c.venue?.indoor === "boolean") out.indoor = c.venue.indoor || ROOFED_VENUES.test(c.venue.fullName ?? "");
  if (c.neutralSite) out.neutralSite = true;
  if (e.weather && typeof e.weather.temperature === "number")
    out.weather = { temperatureF: e.weather.temperature, condition: String(e.weather.displayValue ?? ""), windMph: null, precipChance: null, source: "ESPN" };
  return out;
}
/** Stadiums ESPN lists as open-air that have a fixed roof over the field. */
const ROOFED_VENUES = /SoFi Stadium/i;

interface SportState {
  teams: Team[];
  teamByEspn: Map<string, Team>;
  players: Map<string, Player>;
  games: Map<string, Game>;
  boxes: Map<string, CompactGame>;
  playerLogs: Map<string, PlayerGameLog[]>;
  teamLogs: Map<string, TeamGameLog[]>;
  injuries: Map<string, Injury>;
  baseAt: number;
  sync: { total: number; done: number; failed: number; running: boolean; startedAt: number | null; finishedAt: number | null };
}

export class EspnProvider implements SportsDataProvider {
  readonly isDemo = false;
  readonly info = {
    id: "espn",
    name: "ESPN (public API)",
    kind: "live" as const,
    description:
      "Live schedules, results, box scores, rosters, injuries, headshots and logos from ESPN's public JSON API. Unofficial and not licensed for commercial use — replace with a licensed feed before launching commercially.",
    lastUpdated: new Date().toISOString(),
  };
  private state = new Map<SportId, SportState>();
  private loading = new Map<SportId, Promise<SportState>>();

  constructor() {
    setSportLabels("nfl", { playingTimeLabel: "Opportunities (att + carries + targets)", playingTimeShort: "OPP" });
    setSportLabels("soccer", { playingTimeLabel: "Minutes (estimated)", playingTimeShort: "MIN*" });
    setSportLabels("mlb", { playingTimeLabel: "Plate appearances (approx.) / innings", playingTimeShort: "PA/IP" });
  }

  now(): Date {
    return process.env.DEMO_NOW ? new Date(process.env.DEMO_NOW) : new Date();
  }

  unsupportedStats(sport: SportId) {
    return ESPN_UNSUPPORTED[sport];
  }

  syncStatus() {
    return SPORT_IDS.map((s) => ({ sport: s, ...(this.state.get(s)?.sync ?? { total: 0, done: 0, failed: 0, running: false, startedAt: null, finishedAt: null }) }));
  }

  /** Warm every sport in the background (called at server start). */
  warmAll() {
    for (const s of SPORT_IDS) this.ensure(s).catch((e) => console.warn(`[espn] ${s} warm-up failed:`, (e as Error).message));
  }

  // ------------------------------------------------------------------ loading
  private ensure(sport: SportId): Promise<SportState> {
    const st = this.state.get(sport);
    if (st && Date.now() - st.baseAt < 10 * MIN) return Promise.resolve(st);
    if (this.loading.has(sport)) return st ? Promise.resolve(st) : this.loading.get(sport)!;
    const p = this.loadBase(sport, st)
      .then((s) => {
        this.state.set(sport, s);
        this.startSync(sport, s);
        return s;
      })
      .finally(() => this.loading.delete(sport));
    this.loading.set(sport, p);
    return st ? Promise.resolve(st) : p; // serve existing state while refreshing
  }

  private async loadBase(sport: SportId, prev?: SportState): Promise<SportState> {
    const base = `${SITE}/${PATHS[sport]}`;
    const tj = await espnJson<any>(`${base}/teams`, 7 * DAY);
    const teams: Team[] = [];
    const teamByEspn = new Map<string, Team>();
    for (const { team: t } of tj?.sports?.[0]?.leagues?.[0]?.teams ?? []) {
      const team: Team = {
        id: `${sport}-t${t.id}`,
        sport,
        city: t.location ?? "",
        name: t.name ?? t.shortDisplayName ?? t.displayName,
        fullName: t.displayName,
        abbreviation: t.abbreviation,
        conference: "",
        venue: "",
        colors: { primary: t.color ? `#${t.color}` : "#454a57", secondary: t.alternateColor ? `#${t.alternateColor}` : "#23262e" },
      };
      teams.push(team);
      teamByEspn.set(String(t.id), team);
      const logo = t.logos?.[0]?.href;
      if (logo) registerImage({ entityType: "team", entityId: team.id, url: logo, source: "ESPN", verification: "verified", updatedAt: new Date().toISOString() });
    }
    if (!teams.length) throw new Error(`No ${sport} teams returned by ESPN`);

    // rosters
    const players = new Map<string, Player>();
    await Promise.all(
      teams.map(async (team) => {
        const espnId = team.id.split("-t")[1];
        let rj: any;
        try {
          rj = await espnJson<any>(`${base}/teams/${espnId}/roster`, 12 * HOUR, slimRoster);
        } catch {
          return;
        }
        const list: any[] = [];
        for (const a of rj?.athletes ?? []) {
          if (Array.isArray(a.items)) list.push(...a.items);
          else list.push(a);
        }
        for (const a of list) {
          const pos = a.position?.abbreviation ?? "";
          if (sport === "mlb" && pos === "RP") continue; // no reliever model
          const group = positionGroup(sport, pos);
          if (!group) continue;
          const id = `${sport}-p${a.id}`;
          players.set(id, {
            id,
            sport,
            teamId: team.id,
            firstName: a.firstName ?? "",
            lastName: a.lastName ?? a.displayName ?? "",
            name: a.fullName ?? a.displayName,
            position: pos,
            positionGroup: group,
            jersey: Number(a.jersey ?? 0) || 0,
            age: Number(a.age ?? 0) || 0,
            role: prev?.players.get(id)?.role ?? "rotation",
          });
          const head = a.headshot?.href;
          if (head)
            registerImage({ entityType: "player", entityId: id, teamId: team.id, url: head, source: "ESPN", verification: "verified", updatedAt: new Date().toISOString() });
        }
      }),
    );

    // schedules: current + previous season (completed + scheduled)
    const games = new Map<string, Game>();
    const addEvent = (e: any, seasonYear?: number) => {
      const c = e.competitions?.[0];
      if (!c) return;
      const st = c.status?.type ?? {};
      if (/CANCEL|POSTPONED|SUSPENDED/i.test(st.name ?? "")) return;
      const h = c.competitors?.find((x: any) => x.homeAway === "home");
      const a = c.competitors?.find((x: any) => x.homeAway === "away");
      const ht = teamByEspn.get(String(h?.team?.id ?? h?.id));
      const at = teamByEspn.get(String(a?.team?.id ?? a?.id));
      if (!ht || !at) return;
      const score = (x: any) => {
        const v = typeof x?.score === "object" ? x.score?.value : x?.score;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const completed = !!st.completed;
      const year = Number(e.season?.year ?? seasonYear ?? new Date(e.date).getUTCFullYear());
      games.set(`${sport}-g${e.id}`, {
        id: `${sport}-g${e.id}`,
        sport,
        season: seasonLabel(sport, year),
        date: new Date(e.date).toISOString(),
        homeTeamId: ht.id,
        awayTeamId: at.id,
        venue: c.venue?.fullName ?? "",
        status: completed ? "final" : "scheduled",
        homeScore: completed ? score(h) : null,
        awayScore: completed ? score(a) : null,
        ...gameExtras(e, c),
      });
    };
    let currentYear: number | null = null;
    await Promise.all(
      teams.map(async (team) => {
        const espnId = team.id.split("-t")[1];
        try {
          const cur = await espnJson<any>(`${base}/teams/${espnId}/schedule`, 30 * MIN, slimEvents);
          const y = Number(cur?.season?.year ?? cur?.requestedSeason?.year);
          if (y) currentYear = y;
          for (const e of cur?.events ?? []) addEvent(e, y);
          if (y) {
            const prevSeason = await espnJson<any>(`${base}/teams/${espnId}/schedule?season=${y - 1}`, 30 * DAY, slimEvents);
            for (const e of prevSeason?.events ?? []) addEvent(e, y - 1);
          }
        } catch {
          /* team schedule unavailable */
        }
      }),
    );
    void currentYear;
    // upcoming (and today's) games from daily scoreboards
    const today = this.now();
    for (let d = -1; d <= UPCOMING_DAYS; d++) {
      const day = new Date(today.getTime() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
      try {
        const sb = await espnJson<any>(`${base}/scoreboard?dates=${day}`, d < 0 ? HOUR : 10 * MIN, slimEvents);
        for (const e of sb?.events ?? []) addEvent(e);
      } catch {
        /* skip day */
      }
    }

    // injuries
    const injuries = new Map<string, Injury>();
    try {
      const ij = await espnJson<any>(`${base}/injuries`, 30 * MIN);
      for (const team of ij?.injuries ?? []) {
        for (const i of team.injuries ?? []) {
          const href: string = i.athlete?.links?.find((l: any) => /\/id\/\d+/.test(l.href))?.href ?? "";
          const aid = href.match(/\/id\/(\d+)/)?.[1];
          if (!aid) continue;
          const pid = `${sport}-p${aid}`;
          const details = i.details ?? {};
          const statusText = String(i.status ?? i.type?.description ?? "out");
          const status = injuryStatus(statusText);
          const fantasy = String(details.fantasyStatus?.abbreviation ?? "").toUpperCase();
          const seasonEnding = status === "out" && (fantasy === "OFS" || SEASON_ENDING.test(`${i.shortComment ?? ""} ${i.longComment ?? ""}`));
          const what = [details.type, details.detail].filter(Boolean).join(" — ") || (/suspen/i.test(statusText) ? "Suspension" : "") || "Injury";
          injuries.set(pid, {
            playerId: pid,
            status,
            description: seasonEnding ? `${what} (out for season)` : what,
            updatedAt: i.date ? new Date(i.date).toISOString() : new Date().toISOString(),
            expectedReturn: !seasonEnding && details.returnDate ? new Date(details.returnDate).toISOString() : null,
            seasonEnding,
            note: typeof i.shortComment === "string" ? i.shortComment.slice(0, 400) : null,
          });
        }
      }
    } catch {
      /* injuries unavailable */
    }

    const s: SportState = {
      teams,
      teamByEspn,
      players,
      games,
      boxes: prev?.boxes ?? new Map(),
      playerLogs: new Map(),
      teamLogs: new Map(),
      injuries,
      baseAt: Date.now(),
      sync: prev?.sync ?? { total: 0, done: 0, failed: 0, running: false, startedAt: null, finishedAt: null },
    };
    this.rebuildLogs(sport, s);
    return s;
  }

  /** Background: fetch box scores for the most recent completed games (GAMES_PER_TEAM per team). */
  private startSync(sport: SportId, s: SportState) {
    if (s.sync.running) return;
    const completed = [...s.games.values()].filter((g) => g.status === "final").sort((a, b) => b.date.localeCompare(a.date));
    const count = new Map<string, number>();
    const wanted: Game[] = [];
    for (const g of completed) {
      const ch = count.get(g.homeTeamId) ?? 0;
      const ca = count.get(g.awayTeamId) ?? 0;
      if (ch >= GAMES_PER_TEAM && ca >= GAMES_PER_TEAM) continue;
      wanted.push(g);
      count.set(g.homeTeamId, ch + 1);
      count.set(g.awayTeamId, ca + 1);
    }
    const missing = wanted.filter((g) => !s.boxes.has(g.id));
    s.sync = { total: wanted.length, done: wanted.length - missing.length, failed: 0, running: true, startedAt: Date.now(), finishedAt: null };
    const base = `${SITE}/${PATHS[sport]}`;
    (async () => {
      let sinceRebuild = 0;
      const queue = [...missing];
      const worker = async () => {
        while (queue.length) {
          const g = queue.shift()!;
          const eventId = g.id.split("-g")[1];
          try {
            let box = await readBox<CompactGame>(sport, eventId);
            // older cached boxes lack odds and some fantasy stats: fetch them once more
            if (!box || (box.v ?? 1) < COMPACT_GAME_VERSION) {
              const j = await espnJson<any>(`${base}/summary?event=${eventId}`, 0);
              box = parseSummary(sport, eventId, j);
              if (box) await writeBox(sport, eventId, box);
            }
            if (box) s.boxes.set(g.id, box);
            s.sync.done++;
          } catch {
            s.sync.failed++;
          }
          if (++sinceRebuild >= 40) {
            sinceRebuild = 0;
            this.rebuildLogs(sport, s);
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      this.rebuildLogs(sport, s);
      s.sync.running = false;
      s.sync.finishedAt = Date.now();
      console.log(`[espn] ${sport}: ${s.sync.done}/${s.sync.total} box scores ready (${s.sync.failed} failed)`);
    })().catch((e) => {
      s.sync.running = false;
      console.warn(`[espn] ${sport} sync failed`, e);
    });
  }

  /** Derive team & player game logs from cached box scores; assign roles from usage. */
  private rebuildLogs(sport: SportId, s: SportState) {
    const playerLogs = new Map<string, PlayerGameLog[]>();
    const teamLogs = new Map<string, TeamGameLog[]>();
    const games = [...s.boxes.entries()].map(([id, box]) => ({ g: s.games.get(id), box })).filter((x) => x.g) as { g: Game; box: CompactGame }[];
    games.sort((a, b) => a.g.date.localeCompare(b.g.date));
    for (const { g, box } of games) {
      if (box.odds && !g.odds) g.odds = box.odds;
      const sides = [
        { t: s.teamByEspn.get(box.home.teamEspnId), o: s.teamByEspn.get(box.away.teamEspnId), me: box.home, opp: box.away, home: true },
        { t: s.teamByEspn.get(box.away.teamEspnId), o: s.teamByEspn.get(box.home.teamEspnId), me: box.away, opp: box.home, home: false },
      ];
      for (const x of sides) {
        if (!x.t || !x.o) continue;
        const arr = teamLogs.get(x.t.id) ?? [];
        arr.push({
          teamId: x.t.id, gameId: g.id, sport, season: g.season, date: g.date, opponentId: x.o.id, home: x.home,
          scoreFor: x.me.score, scoreAgainst: x.opp.score, result: x.me.score > x.opp.score ? "W" : x.me.score < x.opp.score ? "L" : "D",
          box: x.me.box, allowed: x.opp.box,
        });
        teamLogs.set(x.t.id, arr);
      }
      for (const line of box.players) {
        const pid = `${sport}-p${line.athleteId}`;
        const team = s.teamByEspn.get(line.teamEspnId);
        if (!team) continue;
        const oppEspn = line.teamEspnId === box.home.teamEspnId ? box.away.teamEspnId : box.home.teamEspnId;
        const opp = s.teamByEspn.get(oppEspn);
        if (!opp) continue;
        const arr = playerLogs.get(pid) ?? [];
        arr.push({
          playerId: pid, gameId: g.id, sport, season: g.season, date: g.date, teamId: team.id, opponentId: opp.id,
          home: line.teamEspnId === box.home.teamEspnId, started: line.starter || !!line.startingPitcher, minutes: line.minutes, stats: line.stats,
        });
        playerLogs.set(pid, arr);
      }
    }
    s.playerLogs = playerLogs;
    s.teamLogs = teamLogs;
    this.assignRoles(sport, s);
  }

  private assignRoles(sport: SportId, s: SportState) {
    const byTeam = new Map<string, Player[]>();
    for (const p of s.players.values()) (byTeam.get(p.teamId) ?? byTeam.set(p.teamId, []).get(p.teamId)!).push(p);
    for (const [tid, roster] of byTeam) {
      const teamGames = (s.teamLogs.get(tid) ?? []).slice(-10).length || 1;
      const recent = (p: Player) => (s.playerLogs.get(p.id) ?? []).filter((l) => l.teamId === tid).slice(-10);
      const usage = (p: Player) => {
        const ls = recent(p);
        return ls.reduce((a, l) => a + l.minutes, 0) / teamGames;
      };
      const pick = (group: string, n: number) =>
        roster
          .filter((p) => p.positionGroup === group)
          .sort((a, b) => usage(b) - usage(a))
          .slice(0, n);
      let starters: Player[] = [];
      switch (sport) {
        case "nba":
        case "soccer":
          starters = roster.filter((p) => {
            const ls = recent(p);
            return ls.length >= 3 && ls.filter((l) => l.started).length / ls.length >= 0.5;
          });
          break;
        case "nfl":
          starters = [...pick("QB", 1), ...pick("RB", 1), ...pick("WR", 3), ...pick("TE", 1), ...pick("K", 1)];
          break;
        case "mlb":
          starters = roster.filter((p) => {
            const ls = recent(p);
            if (p.positionGroup === "SP") return ls.filter((l) => l.started).length >= 2;
            return ls.length >= 6;
          });
          break;
        case "nhl":
          starters = [...pick("F", 6), ...pick("D", 4), ...pick("G", 1)];
          break;
      }
      const ids = new Set(starters.filter((p) => usage(p) > 0).map((p) => p.id));
      for (const p of roster) p.role = ids.has(p.id) ? "starter" : (s.playerLogs.get(p.id)?.length ?? 0) > 0 ? "rotation" : "reserve";
    }
  }

  // ------------------------------------------------------------------ helpers
  private sportOf(id: string): SportId | null {
    const s = id.split("-")[0] as SportId;
    return SPORT_IDS.includes(s) ? s : null;
  }
  private async all(sport?: SportId) {
    return Promise.all((sport ? [sport] : SPORT_IDS).map((s) => this.ensure(s).catch(() => null))).then((xs) => xs.filter((x): x is SportState => !!x));
  }

  /** Today's (and late-yesterday's) games with live state, from the scoreboard (refreshed every ~20s). */
  async liveGames(sport?: SportId): Promise<LiveGame[]> {
    const out: LiveGame[] = [];
    const now = this.now();
    for (const s of await this.all(sport)) {
      const sp = SPORT_IDS.find((x) => this.state.get(x) === s)!;
      const base = `${SITE}/${PATHS[sp]}`;
      for (const d of [-1, 0]) {
        const day = new Date(now.getTime() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
        let sb: any;
        try {
          sb = await espnJson<any>(`${base}/scoreboard?dates=${day}`, d === 0 ? 20_000 : 60_000, slimEvents);
        } catch {
          continue;
        }
        for (const e of sb?.events ?? []) {
          const c = e.competitions?.[0];
          const st = c?.status?.type ?? {};
          if (/CANCEL|POSTPONED/i.test(st.name ?? "")) continue;
          const h = c?.competitors?.find((x: any) => x.homeAway === "home");
          const a = c?.competitors?.find((x: any) => x.homeAway === "away");
          const ht = s.teamByEspn.get(String(h?.team?.id ?? h?.id));
          const at = s.teamByEspn.get(String(a?.team?.id ?? a?.id));
          if (!ht || !at) continue;
          const state: LiveGame["state"] = st.state === "in" ? "in" : st.state === "post" || st.completed ? "post" : "pre";
          const sc = (x: any) => (state === "pre" ? null : Number.isFinite(Number(typeof x?.score === "object" ? x.score?.value : x?.score)) ? Number(typeof x?.score === "object" ? x.score.value : x.score) : null);
          if (out.some((g) => g.id === `${sp}-g${e.id}`)) continue;
          // only yesterday's games that are still live or ended within the last few hours
          if (d === -1 && state === "pre") continue;
          out.push({
            id: `${sp}-g${e.id}`, sport: sp, date: new Date(e.date).toISOString(), homeTeamId: ht.id, awayTeamId: at.id, state,
            homeScore: sc(h), awayScore: sc(a), detail: st.shortDetail ?? (state === "post" ? "Final" : ""), venue: c?.venue?.fullName ?? "",
          });
        }
      }
    }
    return out.sort((x, y) => (x.state === "in" ? 0 : 1) - (y.state === "in" ? 0 : 1) || x.date.localeCompare(y.date));
  }

  // ------------------------------------------------------------------ interface
  async listTeams(sport?: SportId) {
    return (await this.all(sport)).flatMap((s) => s.teams);
  }
  async getTeam(id: string) {
    const sp = this.sportOf(id);
    if (!sp) return null;
    const s = await this.ensure(sp).catch(() => null);
    return s?.teams.find((t) => t.id === id) ?? null;
  }
  async listPlayers(filter?: { sport?: SportId; teamId?: string }) {
    const sport = filter?.sport ?? (filter?.teamId ? this.sportOf(filter.teamId) ?? undefined : undefined);
    const out: Player[] = [];
    for (const s of await this.all(sport)) for (const p of s.players.values()) if (!filter?.teamId || p.teamId === filter.teamId) out.push(p);
    // Only players with data in the synced window are useful for research; keep everyone on rosters but list active players first.
    return out.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "starter" ? -1 : b.role === "starter" ? 1 : a.role === "rotation" ? -1 : 1));
  }
  async getPlayer(id: string) {
    const sp = this.sportOf(id);
    if (!sp) return null;
    const s = await this.ensure(sp).catch(() => null);
    return s?.players.get(id) ?? null;
  }
  async listGames(f: GameFilter = {}) {
    const sport = f.sport ?? (f.teamId ? this.sportOf(f.teamId) ?? undefined : undefined);
    const out: Game[] = [];
    for (const s of await this.all(sport))
      for (const g of s.games.values()) {
        if (f.teamId && g.homeTeamId !== f.teamId && g.awayTeamId !== f.teamId) continue;
        if (f.from && g.date < f.from) continue;
        if (f.to && g.date >= f.to) continue;
        if (f.status && g.status !== f.status) continue;
        out.push(g);
      }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  async getGame(id: string) {
    const sp = this.sportOf(id);
    if (!sp) return null;
    const s = await this.ensure(sp).catch(() => null);
    const g = s?.games.get(id);
    if (g || !s) return g ?? null;
    // a game outside the loaded windows (e.g. an old tracked forecast): fetch its summary directly
    return this.fetchSingleGame(sp, s, id);
  }
  private async fetchSingleGame(sport: SportId, s: SportState, id: string): Promise<Game | null> {
    try {
      const eventId = id.split("-g")[1];
      const j = await espnJson<any>(`${SITE}/${PATHS[sport]}/summary?event=${eventId}`, 10 * MIN);
      const comp = j?.header?.competitions?.[0];
      if (!comp) return null;
      const h = comp.competitors.find((x: any) => x.homeAway === "home");
      const a = comp.competitors.find((x: any) => x.homeAway === "away");
      const ht = s.teamByEspn.get(String(h.team.id));
      const at = s.teamByEspn.get(String(a.team.id));
      if (!ht || !at) return null;
      const done = !!comp.status?.type?.completed;
      const g: Game = {
        id, sport, season: seasonLabel(sport, Number(j?.header?.season?.year ?? new Date(comp.date).getUTCFullYear())), date: new Date(comp.date).toISOString(),
        homeTeamId: ht.id, awayTeamId: at.id, venue: j?.gameInfo?.venue?.fullName ?? "", status: done ? "final" : "scheduled",
        homeScore: done ? Number(h.score) : null, awayScore: done ? Number(a.score) : null,
      };
      s.games.set(id, g);
      if (done) {
        const box = parseSummary(sport, eventId, j);
        if (box) {
          await writeBox(sport, eventId, box);
          s.boxes.set(id, box);
          this.rebuildLogs(sport, s);
        }
      }
      return g;
    } catch {
      return null;
    }
  }
  async getPlayerLogs(playerId: string, opts?: { before?: string }) {
    const sp = this.sportOf(playerId);
    if (!sp) return [];
    const s = await this.ensure(sp).catch(() => null);
    const logs = s?.playerLogs.get(playerId) ?? [];
    return logs.filter((l) => !opts?.before || l.date < opts.before);
  }
  async getGamePlayerLogs(gameId: string) {
    const sp = this.sportOf(gameId);
    if (!sp) return [];
    const s = await this.ensure(sp).catch(() => null);
    if (!s) return [];
    let g = s.games.get(gameId) ?? (await this.getGame(gameId));
    if (!g || g.status !== "final") return [];
    if (!s.boxes.has(gameId)) {
      // grading needs this game's final box score even if it is outside the sync window
      await this.fetchSingleGame(sp, s, gameId);
      g = s.games.get(gameId)!;
    }
    const out: PlayerGameLog[] = [];
    for (const logs of s.playerLogs.values()) for (const l of logs) if (l.gameId === gameId) out.push(l);
    return out;
  }
  async getTeamLogs(f: { teamId?: string; sport?: SportId; before?: string }) {
    const sport = f.sport ?? (f.teamId ? this.sportOf(f.teamId) ?? undefined : undefined);
    const out: TeamGameLog[] = [];
    for (const s of await this.all(sport)) {
      if (f.teamId) out.push(...(s.teamLogs.get(f.teamId) ?? []));
      else for (const ls of s.teamLogs.values()) out.push(...ls);
    }
    return out.filter((l) => !f.before || l.date < f.before).sort((a, b) => a.date.localeCompare(b.date));
  }
  async getInjuries(sport?: SportId) {
    return (await this.all(sport)).flatMap((s) => [...s.injuries.values()]);
  }
  async getInjury(playerId: string) {
    const sp = this.sportOf(playerId);
    if (!sp) return null;
    const s = await this.ensure(sp).catch(() => null);
    return s?.injuries.get(playerId) ?? null;
  }
}
