import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { navigate } from "@/router";
import { PlayerAvatar, TeamLogo } from "@/components/media";
import { ListCard, ListRow, Section } from "@/components/mobile";
import { SportTag } from "@/components/ui";
import { RecentPlayers } from "@/components/actions";

interface Results {
  players: { id: string; name: string; imageUrl: string | null; team: string; teamColor: string; position: string; sport: string }[];
  teams: { id: string; fullName: string; abbreviation: string; logoUrl: string | null; colors: { primary: string; secondary: string }; sport: string }[];
  games: { id: string; label: string; date: string; sport: string }[];
  stats: { key: string; label: string; sport: string; href: string }[];
}

export default function Search({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
      setRes(await r.json());
      setBusy(false);
      navigate(`/search?q=${encodeURIComponent(q)}`, { replace: true });
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  const empty = res && !res.players.length && !res.teams.length && !res.games.length && !res.stats.length;

  return (
    <div className="space-y-5">
      <input ref={input} className="input" type="search" placeholder="Players, teams, games, stats…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" enterKeyHint="search" />
      {!res && !busy && (
        <div className="space-y-4">
          <p className="px-1 text-xs text-ink-400">Type at least 2 letters — try a player name, a team (“Lakers”, “BOS”) or a stat (“rebounds”).</p>
          <RecentPlayers sport={null} />
        </div>
      )}
      {busy && !res && <div className="px-1 text-xs text-ink-400">Searching…</div>}
      {empty && <div className="card card-pad text-center text-sm text-ink-400">No matches for “{q}”.</div>}
      {res && res.players.length > 0 && (
        <Section title="Players">
          <ListCard>
            {res.players.map((p) => (
              <ListRow key={p.id} href={`/players/${p.id}`} leading={<PlayerAvatar name={p.name} imageUrl={p.imageUrl} size="sm" ringColor={p.teamColor} />} title={p.name} sub={`${p.team} · ${p.position}`} trailing={<SportTag sport={p.sport} />} />
            ))}
          </ListCard>
        </Section>
      )}
      {res && res.teams.length > 0 && (
        <Section title="Teams">
          <ListCard>
            {res.teams.map((t) => (
              <ListRow key={t.id} href={`/teams/${t.id}`} leading={<TeamLogo abbreviation={t.abbreviation} name={t.fullName} logoUrl={t.logoUrl} colors={t.colors} size="sm" />} title={t.fullName} trailing={<SportTag sport={t.sport} />} />
            ))}
          </ListCard>
        </Section>
      )}
      {res && res.games.length > 0 && (
        <Section title="Games">
          <ListCard>
            {res.games.map((g) => (
              <ListRow key={g.id} href={`/matchups/${g.id}`} title={g.label} sub={g.date} />
            ))}
          </ListCard>
        </Section>
      )}
      {res && res.stats.length > 0 && (
        <Section title="Stat leaderboards">
          <ListCard>
            {res.stats.map((s) => (
              <ListRow
                key={s.sport + s.key}
                onClick={() => {
                  localStorage.setItem("sl.sport", s.sport);
                  window.dispatchEvent(new Event("sport-change"));
                  navigate(`/stats?stat=${s.key}`);
                }}
                title={s.label}
                trailing={<SportTag sport={s.sport} />}
              />
            ))}
          </ListCard>
        </Section>
      )}
    </div>
  );
}
