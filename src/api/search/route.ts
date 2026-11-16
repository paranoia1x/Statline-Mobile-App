import { getProvider } from "@/lib/data";
import { playerImageUrl, teamLogoUrl } from "@/lib/images";
import { SPORTS } from "@/lib/sports";
import { SPORT_IDS } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { json } from "@/lib/server/http";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return json({ players: [], teams: [], games: [], stats: [] });
  const p = getProvider();
  const [teams, players] = await Promise.all([p.listTeams(), p.listPlayers()]);
  const tmap = new Map(teams.map((t) => [t.id, t]));
  const terms = q.split(/\s+/);
  const matches = (s: string) => terms.every((t) => s.toLowerCase().includes(t));

  const ps = players
    .filter((pl) => matches(`${pl.name} ${tmap.get(pl.teamId)?.fullName} ${tmap.get(pl.teamId)?.abbreviation} ${pl.position} ${pl.sport}`))
    .slice(0, 8)
    .map((pl) => {
      const t = tmap.get(pl.teamId)!;
      return { id: pl.id, name: pl.name, imageUrl: playerImageUrl(pl), team: t.abbreviation, teamColor: t.colors.primary, position: pl.position, sport: pl.sport };
    });
  const ts = teams
    .filter((t) => matches(`${t.fullName} ${t.abbreviation} ${t.sport} ${SPORTS[t.sport].name}`))
    .slice(0, 6)
    .map((t) => ({ id: t.id, fullName: t.fullName, abbreviation: t.abbreviation, logoUrl: teamLogoUrl(t), colors: t.colors, sport: t.sport }));

  // games: upcoming / recent involving matching teams
  const teamHits = teams.filter((t) => terms.some((term) => `${t.fullName} ${t.abbreviation}`.toLowerCase().includes(term)));
  const now = p.now();
  const from = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const to = new Date(now.getTime() + 10 * 86_400_000).toISOString();
  const games = [];
  for (const t of teamHits.slice(0, 2)) {
    const gs = await p.listGames({ teamId: t.id, from, to });
    for (const g of gs.slice(0, 4)) {
      const h = tmap.get(g.homeTeamId)!;
      const a = tmap.get(g.awayTeamId)!;
      games.push({ id: g.id, label: `${a.abbreviation} @ ${h.abbreviation} · ${SPORTS[g.sport].name}`, date: fmtDate(g.date), sport: g.sport });
    }
  }
  const stats = SPORT_IDS.flatMap((sid) =>
    SPORTS[sid].stats
      .filter((s) => matches(`${s.label} ${s.short} ${SPORTS[sid].name}`))
      .map((s) => ({ key: s.key, label: s.label, sport: sid, href: `/stats?sport=${sid}&stat=${s.key}` })),
  ).slice(0, 6);
  return json({ players: ps, teams: ts, games: games.slice(0, 6), stats });
}
