import { useData, useSport } from "@/hooks";
import { getTeamProfiles } from "@/lib/engine/team";
import { formatStat, SPORTS } from "@/lib/sports";
import { SPORT_IDS } from "@/lib/types";
import { teamVM } from "@/lib/view";
import { TeamLogo } from "@/components/media";
import { ListCard, Loading, Section } from "@/components/mobile";
import { PercentileBar } from "@/components/ui";

export default function Teams() {
  const [sport] = useSport();
  const d = useData(async () => Promise.all((sport ? [sport] : SPORT_IDS).map(async (s) => ({ s, profiles: [...(await getTeamProfiles(s)).values()] }))), [sport]);
  if (!d.data) return <Loading rows={5} />;
  return (
    <div className="space-y-6">
      {d.data.map(({ s, profiles }) => {
        const sdef = SPORTS[s];
        const offKey = sdef.teamMetrics.find((m) => m.side === "offense")!;
        const defKey = sdef.teamMetrics.find((m) => m.side === "defense")!;
        const sorted = [...profiles].sort((a, b) => b.record.w - a.record.w || a.record.l - b.record.l);
        const rec = (r: { w: number; l: number; d: number }) => `${r.w}-${r.l}${sdef.allowDraw ? `-${r.d}` : ""}`;
        return (
          <Section key={s} title={`${sdef.name} teams`}>
            <p className="-mt-1 px-1 text-[11px] text-ink-400">Bars: league percentile for {offKey.label.toLowerCase()} and {defKey.label.toLowerCase()} (100 = best)</p>
            <ListCard>
              {sorted.map((p) => {
                const vm = teamVM(p.team);
                const o = p.offense.find((m) => m.def.key === offKey.key)!;
                const df = p.defense.find((m) => m.def.key === defKey.key)!;
                return (
                  <a key={p.team.id} href={`#/teams/${p.team.id}`} className="flex items-center gap-3 px-3.5 py-3 active:bg-ink-800">
                    <TeamLogo abbreviation={vm.abbreviation} name={vm.fullName} logoUrl={vm.logoUrl} colors={vm.colors} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink-100">{p.team.fullName}</span>
                        <span className="num shrink-0 text-xs text-ink-300">{rec(p.record)}</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-3 text-[10px] text-ink-400">
                        <div>
                          <div className="mb-0.5 flex justify-between"><span>OFF</span><span className="num text-ink-200">{formatStat(o.value, o.def.format)}</span></div>
                          <PercentileBar percentile={o.percentile} />
                        </div>
                        <div>
                          <div className="mb-0.5 flex justify-between"><span>DEF</span><span className="num text-ink-200">{formatStat(df.value, df.def.format)}</span></div>
                          <PercentileBar percentile={df.percentile} />
                        </div>
                      </div>
                    </div>
                  </a>
                );
              })}
            </ListCard>
          </Section>
        );
      })}
    </div>
  );
}
