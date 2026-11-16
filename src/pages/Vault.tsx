import { provider } from "@/boot";
import { useData } from "@/hooks";
import { getStore } from "@/lib/store";
import { playersVM } from "@/lib/server/lookups";
import { teamVM, type PlayerVM, type TeamVM } from "@/lib/view";
import { VaultBrowser } from "@/components/VaultBrowser";
import { Loading } from "@/components/mobile";

export default function Vault({ openId }: { openId?: string }) {
  const d = useData(async () => {
    const items = await getStore().listVaultItems();
    const pids = [...new Set(items.flatMap((i) => i.refs.playerIds ?? []))];
    const tids = [...new Set(items.flatMap((i) => i.refs.teamIds ?? []))];
    const players = await playersVM((await Promise.all(pids.map((id) => provider.getPlayer(id)))).filter((p): p is NonNullable<typeof p> => !!p));
    const teams = (await Promise.all(tids.map((id) => provider.getTeam(id)))).filter((t): t is NonNullable<typeof t> => !!t).map(teamVM);
    return { items, players: Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, PlayerVM>, teams: Object.fromEntries(teams.map((t) => [t.id, t])) as Record<string, TeamVM> };
  }, []);
  if (!d.data) return <Loading rows={3} />;
  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-ink-400">{d.data.items.length} saved item{d.data.items.length === 1 ? "" : "s"} · stored on this phone. Back them up from Settings.</p>
      <VaultBrowser items={d.data.items} players={d.data.players} teams={d.data.teams} openId={openId} />
    </div>
  );
}
