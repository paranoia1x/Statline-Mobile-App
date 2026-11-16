import { provider } from "@/boot";
import { useData } from "@/hooks";
import { visibleStats } from "@/lib/data";
import { playersVM } from "@/lib/server/lookups";
import { SPORT_IDS } from "@/lib/types";
import { teamVM } from "@/lib/view";
import { navigate } from "@/router";
import { Analyzer } from "@/components/Analyzer";
import { ParlayAnalyzer } from "@/components/ParlayAnalyzer";
import { Loading, Segmented } from "@/components/mobile";

/** Pick Analyzer and Parlay Analyzer, side by side under one tab. */
export default function Analyze({ tab }: { tab: "picks" | "parlay" }) {
  const dir = useData(async () => {
    const [players, teams] = await Promise.all([provider.listPlayers(), provider.listTeams()]);
    const stats = Object.fromEntries(SPORT_IDS.map((s) => [s, visibleStats(s).filter((x) => x.forecastable).map((x) => ({ key: x.key, label: x.label, groups: x.groups }))]));
    return { players: await playersVM(players), teams: teams.map(teamVM), stats };
  }, []);
  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        options={[
          { id: "picks", label: "Pick Analyzer" },
          { id: "parlay", label: "Parlay Analyzer" },
        ]}
        onChange={(v) => navigate(v === "parlay" ? "/parlay" : "/analyzer", { replace: true })}
      />
      <p className="px-1 text-xs leading-relaxed text-ink-400">
        {tab === "parlay"
          ? "Upload a screenshot of your bet slip (or paste it). STATLINE reads every leg — player props, moneylines, spreads and totals — gives each a probability, and works out the chance the whole parlay hits."
          : "Upload a screenshot of your picks (or paste them). Confirm what was read, then get an independent statistical report and a hit/miss verdict for each one. Screenshots are read on your phone."}
      </p>
      {!dir.data ? <Loading rows={2} /> : tab === "parlay" ? <ParlayAnalyzer dir={dir.data} signedIn /> : <Analyzer dir={dir.data} signedIn />}
    </div>
  );
}
