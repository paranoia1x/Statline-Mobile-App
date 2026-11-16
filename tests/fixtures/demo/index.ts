import type { SportsDataProvider, GameFilter } from "@/lib/data/provider";
import type { Game, Injury, LiveGame, PlayerGameLog, SportId, TeamGameLog } from "@/lib/types";
import { generateUniverse, injuryAt, type DemoUniverse } from "./generate";

const GAME_DURATION_MS = 3.5 * 3600_000;

export class DemoProvider implements SportsDataProvider {
  readonly isDemo = true;
  readonly info = {
    id: "demo",
    name: "Demo data (synthetic)",
    kind: "demo" as const,
    description:
      "Deterministic, fictional teams, players and results generated locally. Clearly labelled demo data — not real statistics.",
    lastUpdated: new Date().toISOString(),
  };
  private u: DemoUniverse;
  private playerLogIndex = new Map<string, PlayerGameLog[]>();
  private gameLogIndex = new Map<string, PlayerGameLog[]>();
  private teamLogIndex = new Map<string, TeamGameLog[]>();
  private gameIndex = new Map<string, Game>();

  constructor() {
    this.u = generateUniverse();
    for (const l of this.u.playerLogs) {
      (this.playerLogIndex.get(l.playerId) ?? this.playerLogIndex.set(l.playerId, []).get(l.playerId)!).push(l);
      (this.gameLogIndex.get(l.gameId) ?? this.gameLogIndex.set(l.gameId, []).get(l.gameId)!).push(l);
    }
    for (const l of this.u.teamLogs) (this.teamLogIndex.get(l.teamId) ?? this.teamLogIndex.set(l.teamId, []).get(l.teamId)!).push(l);
    for (const g of this.u.games) this.gameIndex.set(g.id, g);
  }

  now(): Date {
    const o = process.env.DEMO_NOW;
    return o ? new Date(o) : new Date();
  }

  private isFinal(dateIso: string) {
    return Date.parse(dateIso) + GAME_DURATION_MS < this.now().getTime();
  }

  private mask(g: Game): Game {
    return this.isFinal(g.date) ? g : { ...g, status: "scheduled", homeScore: null, awayScore: null };
  }

  /** Demo live state: games in progress show a partial score proportional to elapsed time. */
  async liveGames(sport?: SportId): Promise<LiveGame[]> {
    const now = this.now().getTime();
    const out: LiveGame[] = [];
    for (const g of this.u.games) {
      if (sport && g.sport !== sport) continue;
      const start = Date.parse(g.date);
      if (start > now + 18 * 3600_000 || start + GAME_DURATION_MS < now - 6 * 3600_000) continue;
      const elapsed = (now - start) / GAME_DURATION_MS;
      const state: LiveGame["state"] = elapsed < 0 ? "pre" : elapsed >= 1 ? "post" : "in";
      const part = (v: number | null) => (v == null ? null : state === "post" ? v : Math.floor(v * Math.min(1, elapsed)));
      out.push({
        id: g.id, sport: g.sport, date: g.date, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, state,
        homeScore: state === "pre" ? null : part(g.homeScore), awayScore: state === "pre" ? null : part(g.awayScore),
        detail: state === "pre" ? "Scheduled" : state === "post" ? "Final" : `In progress (${Math.round(elapsed * 100)}%)`, venue: g.venue,
      });
    }
    return out.sort((x, y) => (x.state === "in" ? 0 : 1) - (y.state === "in" ? 0 : 1) || x.date.localeCompare(y.date));
  }

  async listTeams(sport?: SportId) {
    return this.u.teams.filter((t) => !sport || t.sport === sport);
  }
  async getTeam(id: string) {
    return this.u.teams.find((t) => t.id === id) ?? null;
  }
  async listPlayers(filter?: { sport?: SportId; teamId?: string }) {
    return this.u.players.filter((p) => (!filter?.sport || p.sport === filter.sport) && (!filter?.teamId || p.teamId === filter.teamId));
  }
  async getPlayer(id: string) {
    return this.u.players.find((p) => p.id === id) ?? null;
  }
  async listGames(f: GameFilter = {}) {
    const out: Game[] = [];
    for (const g of this.u.games) {
      if (f.sport && g.sport !== f.sport) continue;
      if (f.teamId && g.homeTeamId !== f.teamId && g.awayTeamId !== f.teamId) continue;
      if (f.from && g.date < f.from) continue;
      if (f.to && g.date >= f.to) continue;
      const m = this.mask(g);
      if (f.status && m.status !== f.status) continue;
      out.push(m);
    }
    return out;
  }
  async getGame(id: string) {
    const g = this.gameIndex.get(id);
    return g ? this.mask(g) : null;
  }
  async getPlayerLogs(playerId: string, opts?: { before?: string }) {
    const logs = this.playerLogIndex.get(playerId) ?? [];
    return logs.filter((l) => this.isFinal(l.date) && (!opts?.before || l.date < opts.before));
  }
  async getGamePlayerLogs(gameId: string) {
    const g = this.gameIndex.get(gameId);
    if (!g || !this.isFinal(g.date)) return [];
    return this.gameLogIndex.get(gameId) ?? [];
  }
  async getTeamLogs(f: { teamId?: string; sport?: SportId; before?: string }) {
    const src = f.teamId ? this.teamLogIndex.get(f.teamId) ?? [] : this.u.teamLogs;
    return src.filter((l) => (!f.sport || l.sport === f.sport) && this.isFinal(l.date) && (!f.before || l.date < f.before));
  }
  async getInjuries(sport?: SportId) {
    const at = this.now().getTime();
    const out: Injury[] = [];
    for (const p of this.u.players) {
      if (sport && p.sport !== sport) continue;
      const inj = injuryAt(this.u.spells, p.id, at);
      if (inj) out.push(inj);
    }
    return out;
  }
  async getInjury(playerId: string) {
    return injuryAt(this.u.spells, playerId, this.now().getTime());
  }
}
