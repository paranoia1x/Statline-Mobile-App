/**
 * SnapshotProvider: the app's data source on phones.
 *
 * Box scores, schedules, rosters and injuries come from snapshot files that a scheduled
 * GitHub job builds from ESPN (public/data/<sport>.json). Each sport is downloaded the
 * first time it is needed and cached for offline use by the service worker. Live scores
 * are fetched straight from ESPN's public scoreboard (it allows browser requests).
 */
import type { GameFilter, SportsDataProvider } from "./provider";
import type { Game, Injury, LiveGame, Player, PlayerGameLog, SportId, Team, TeamGameLog } from "@/lib/types";
import { SPORT_IDS } from "@/lib/types";
import { setSportLabels } from "@/lib/sports";
import { setImageMaps } from "@/lib/images";
import { unpackLogs, unpackTeamLogs, type SnapshotMeta, type SportSnapshot } from "./snapshot-format";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SportState {
  snap: SportSnapshot;
  teams: Team[];
  teamById: Map<string, Team>;
  players: Player[];
  playerById: Map<string, Player>;
  games: Game[]; // sorted by date
  gameById: Map<string, Game>;
  logsByPlayer: Map<string, PlayerGameLog[]>;
  logsByGame: Map<string, PlayerGameLog[]>;
  teamLogsByTeam: Map<string, TeamGameLog[]>;
  allTeamLogs: TeamGameLog[];
  injuries: Map<string, Injury>;
}

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const PATHS: Record<SportId, string> = { nba: "basketball/nba", nfl: "football/nfl", mlb: "baseball/mlb", nhl: "hockey/nhl", soccer: "soccer/eng.1" };
const ROLE_ORDER = { starter: 0, rotation: 1, reserve: 2 } as const;

export type LoadListener = (sport: SportId, phase: "loading" | "ready" | "error") => void;

export class SnapshotProvider implements SportsDataProvider {
  readonly isDemo = false;
  info = { id: "espn-snapshot", name: "ESPN (public API)", kind: "live" as const, description: "Box scores, schedules and injuries from ESPN's public API, refreshed every few hours.", lastUpdated: "" };
  meta: SnapshotMeta | null = null;
  private state = new Map<SportId, SportState>();
  private loading = new Map<SportId, Promise<SportState>>();
  private listeners = new Set<LoadListener>();
  private liveCache = new Map<string, { at: number; games: LiveGame[] }>();

  constructor(private baseUrl: string) {}

  /** Fixed clock for tests (null = real time). */
  fixedNow: Date | null = null;
  now() {
    return this.fixedNow ? new Date(this.fixedNow) : new Date();
  }

  onLoad(fn: LoadListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(sport: SportId, phase: "loading" | "ready" | "error") {
    this.listeners.forEach((l) => l(sport, phase));
  }

  async loadMeta(): Promise<SnapshotMeta> {
    const r = await fetch(`${this.baseUrl}data/meta.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Couldn't load the stats index (${r.status})`);
    this.meta = (await r.json()) as SnapshotMeta;
    this.info.lastUpdated = this.meta.generatedAt;
    return this.meta;
  }

  isLoaded(sport: SportId) {
    return this.state.has(sport);
  }

  ensure(sport: SportId): Promise<SportState> {
    const s = this.state.get(sport);
    if (s) return Promise.resolve(s);
    let p = this.loading.get(sport);
    if (!p) {
      this.emit(sport, "loading");
      p = this.fetchSport(sport).then(
        (st) => {
          this.state.set(sport, st);
          this.loading.delete(sport);
          this.emit(sport, "ready");
          return st;
        },
        (e) => {
          this.loading.delete(sport);
          this.emit(sport, "error");
          throw e;
        },
      );
      this.loading.set(sport, p);
    }
    return p;
  }

  private async fetchSport(sport: SportId): Promise<SportState> {
    const file = this.meta?.sports.find((x) => x.sport === sport)?.file ?? `${sport}.json`;
    const r = await fetch(`${this.baseUrl}data/${file}`);
    if (!r.ok) throw new Error(`Couldn't load ${sport.toUpperCase()} stats (${r.status})`);
    return this.index((await r.json()) as SportSnapshot);
  }

  /** Builds lookup indexes from a snapshot (also used by the data job and tests). */
  index(snap: SportSnapshot): SportState {
    setSportLabels(snap.sport, snap.labels);
    setImageMaps(snap.images);
    const logs = unpackLogs(snap);
    const teamLogs = unpackTeamLogs(snap);
    const logsByPlayer = new Map<string, PlayerGameLog[]>();
    const logsByGame = new Map<string, PlayerGameLog[]>();
    for (const l of logs) {
      (logsByPlayer.get(l.playerId) ?? logsByPlayer.set(l.playerId, []).get(l.playerId)!).push(l);
      (logsByGame.get(l.gameId) ?? logsByGame.set(l.gameId, []).get(l.gameId)!).push(l);
    }
    for (const ls of logsByPlayer.values()) ls.sort((a, b) => a.date.localeCompare(b.date));
    const teamLogsByTeam = new Map<string, TeamGameLog[]>();
    for (const l of teamLogs) (teamLogsByTeam.get(l.teamId) ?? teamLogsByTeam.set(l.teamId, []).get(l.teamId)!).push(l);
    for (const ls of teamLogsByTeam.values()) ls.sort((a, b) => a.date.localeCompare(b.date));
    const games = [...snap.games].sort((a, b) => a.date.localeCompare(b.date));
    const players = [...snap.players].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
    return {
      snap,
      teams: snap.teams,
      teamById: new Map(snap.teams.map((t) => [t.id, t])),
      players,
      playerById: new Map(players.map((p) => [p.id, p])),
      games,
      gameById: new Map(games.map((g) => [g.id, g])),
      logsByPlayer,
      logsByGame,
      teamLogsByTeam,
      allTeamLogs: teamLogs.sort((a, b) => a.date.localeCompare(b.date)),
      injuries: new Map(snap.injuries.map((i) => [i.playerId, i])),
    };
  }

  /** Load a snapshot that is already in memory (data job / tests). */
  attach(snap: SportSnapshot) {
    this.state.set(snap.sport, this.index(snap));
  }

  unsupportedStats(sport: SportId) {
    return this.state.get(sport)?.snap.unsupported ?? [];
  }

  private sportOf(id: string): SportId | null {
    const s = id.split("-")[0] as SportId;
    return SPORT_IDS.includes(s) ? s : null;
  }
  private async all(sport?: SportId | null) {
    const ids = sport ? [sport] : SPORT_IDS;
    const xs = await Promise.all(ids.map((s) => this.ensure(s).catch(() => null)));
    return xs.filter((x): x is SportState => !!x);
  }
  private async one(id: string) {
    const sp = this.sportOf(id);
    return sp ? this.ensure(sp).catch(() => null) : null;
  }

  async listTeams(sport?: SportId) {
    return (await this.all(sport)).flatMap((s) => s.teams);
  }
  async getTeam(id: string) {
    return (await this.one(id))?.teamById.get(id) ?? null;
  }
  async listPlayers(filter?: { sport?: SportId; teamId?: string }) {
    const sport = filter?.sport ?? (filter?.teamId ? this.sportOf(filter.teamId) ?? undefined : undefined);
    const out: Player[] = [];
    for (const s of await this.all(sport)) for (const p of s.players) if (!filter?.teamId || p.teamId === filter.teamId) out.push(p);
    return out;
  }
  async getPlayer(id: string) {
    return (await this.one(id))?.playerById.get(id) ?? null;
  }
  async listGames(f: GameFilter = {}) {
    const sport = f.sport ?? (f.teamId ? this.sportOf(f.teamId) ?? undefined : undefined);
    const out: Game[] = [];
    for (const s of await this.all(sport))
      for (const g of s.games) {
        if (f.teamId && g.homeTeamId !== f.teamId && g.awayTeamId !== f.teamId) continue;
        if (f.from && g.date < f.from) continue;
        if (f.to && g.date >= f.to) continue;
        if (f.status && g.status !== f.status) continue;
        out.push(g);
      }
    return sport ? out : out.sort((a, b) => a.date.localeCompare(b.date));
  }
  async getGame(id: string) {
    return (await this.one(id))?.gameById.get(id) ?? null;
  }
  async getPlayerLogs(playerId: string, opts?: { before?: string }) {
    const logs = (await this.one(playerId))?.logsByPlayer.get(playerId) ?? [];
    return opts?.before ? logs.filter((l) => l.date < opts.before!) : logs;
  }
  async getGamePlayerLogs(gameId: string) {
    return (await this.one(gameId))?.logsByGame.get(gameId) ?? [];
  }
  async getTeamLogs(f: { teamId?: string; sport?: SportId; before?: string }) {
    const sport = f.sport ?? (f.teamId ? this.sportOf(f.teamId) ?? undefined : undefined);
    let out: TeamGameLog[] = [];
    for (const s of await this.all(sport)) out.push(...(f.teamId ? s.teamLogsByTeam.get(f.teamId) ?? [] : s.allTeamLogs));
    if (f.before) out = out.filter((l) => l.date < f.before!);
    return sport ? out : out.sort((a, b) => a.date.localeCompare(b.date));
  }
  async getInjuries(sport?: SportId) {
    return (await this.all(sport)).flatMap((s) => [...s.injuries.values()]);
  }
  async getInjury(playerId: string) {
    return (await this.one(playerId))?.injuries.get(playerId) ?? null;
  }

  /** Today's and late-yesterday's games with live state, straight from ESPN's scoreboard. */
  async liveGames(sport?: SportId): Promise<LiveGame[]> {
    const out: LiveGame[] = [];
    const now = this.now();
    const states = await this.all(sport);
    await Promise.all(
      states.map(async (s) => {
        const sp = s.snap.sport;
        for (const d of [-1, 0]) {
          const day = new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
          const games = await this.scoreboard(sp, day, d === 0 ? 20_000 : 120_000, s).catch(() => {
            this.liveSource = "snapshot";
            return this.fromSnapshot(s, day);
          });
          for (const g of games) if (!(d === -1 && g.state === "pre") && !out.some((x) => x.id === g.id)) out.push(g);
        }
      }),
    );
    return out.sort((x, y) => (x.state === "in" ? 0 : 1) - (y.state === "in" ? 0 : 1) || x.date.localeCompare(y.date));
  }

  /** "espn" while live scoreboards load; "snapshot" when ESPN couldn't be reached (offline etc.). */
  liveSource: "espn" | "snapshot" = "espn";

  /** Fallback when the live scoreboard is unreachable: that day's games from the last snapshot. */
  private fromSnapshot(s: SportState, day: string): LiveGame[] {
    const key = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const now = Date.now();
    return s.games
      .filter((g) => g.date.slice(0, 10) === key)
      .map((g) => {
        const started = Date.parse(g.date) <= now;
        const state: LiveGame["state"] = g.status === "final" ? "post" : started ? "in" : "pre";
        return {
          id: g.id, sport: s.snap.sport, date: g.date, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, state,
          homeScore: g.homeScore, awayScore: g.awayScore, detail: state === "post" ? "Final" : state === "in" ? "In progress" : "", venue: g.venue,
        };
      });
  }

  private async scoreboard(sp: SportId, day: string, ttl: number, s: SportState): Promise<LiveGame[]> {
    const key = `${sp}:${day}`;
    const hit = this.liveCache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.games;
    const r = await fetch(`${ESPN}/${PATHS[sp]}/scoreboard?dates=${day}`);
    if (!r.ok) throw new Error(String(r.status));
    this.liveSource = "espn";
    const sb: any = await r.json();
    const games: LiveGame[] = [];
    for (const e of sb?.events ?? []) {
      const c = e.competitions?.[0];
      const st = c?.status?.type ?? {};
      if (/CANCEL|POSTPONED/i.test(st.name ?? "")) continue;
      const h = c?.competitors?.find((x: any) => x.homeAway === "home");
      const a = c?.competitors?.find((x: any) => x.homeAway === "away");
      const hid = `${sp}-t${h?.team?.id ?? h?.id}`;
      const aid = `${sp}-t${a?.team?.id ?? a?.id}`;
      if (!s.teamById.has(hid) || !s.teamById.has(aid)) continue;
      const state: LiveGame["state"] = st.state === "in" ? "in" : st.state === "post" || st.completed ? "post" : "pre";
      const sc = (x: any) => {
        if (state === "pre") return null;
        const v = Number(typeof x?.score === "object" ? x.score?.value : x?.score);
        return Number.isFinite(v) ? v : null;
      };
      games.push({
        id: `${sp}-g${e.id}`, sport: sp, date: new Date(e.date).toISOString(), homeTeamId: hid, awayTeamId: aid, state,
        homeScore: sc(h), awayScore: sc(a), detail: st.shortDetail ?? (state === "post" ? "Final" : ""), venue: c?.venue?.fullName ?? "",
      });
    }
    this.liveCache.set(key, { at: Date.now(), games });
    return games;
  }
}
