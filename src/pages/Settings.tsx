import { useRef, useState } from "react";
import { provider, resetCaches } from "@/boot";
import { useSport } from "@/hooks";
import { clearAll, exportBackup, importBackup } from "@/lib/store";
import { SPORTS } from "@/lib/sports";
import { SPORT_IDS, type SportId } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { refreshData } from "@/router";
import { AppearancePanel } from "@/components/AppearancePicker";
import { Disclaimer, ICONS, ListCard, Section } from "@/components/mobile";
import { NavIcon } from "@/components/icons";

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Opens the share sheet with the backup file (falls back to a download). */
async function shareBackup() {
  const json = JSON.stringify(exportBackup(), null, 1);
  const name = `statline-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: "application/json" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "STATLINE backup" });
      return "Backup ready — choose where to save it.";
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return "Backup downloaded.";
}

export default function Settings() {
  const [sport, setSport] = useSport();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = provider.meta;

  return (
    <div className="space-y-7">
      <Section title="Appearance">
        <div className="card card-pad">
          <AppearancePanel />
        </div>
      </Section>

      <Section title="Default sport">
        <div className="card card-pad">
          <select className="input" value={sport ?? ""} onChange={(e) => setSport((e.target.value || null) as SportId | null)} aria-label="Default sport">
            <option value="">All sports</option>
            {SPORT_IDS.map((s) => (
              <option key={s} value={s}>{SPORTS[s].name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-ink-400">The sport the app opens with. You can switch anytime with the chips at the top.</p>
        </div>
      </Section>

      {!standalone && (
        <Section title="Install on your phone">
          <div className="card card-pad space-y-2 text-sm text-ink-200">
            <div className="flex items-center gap-2 font-medium text-white">
              <NavIcon d={ICONS.phone} className="h-5 w-5 text-brand-bright" /> Add STATLINE to your home screen
            </div>
            {isIOS ? (
              <p>In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It opens full-screen like an app and works offline.</p>
            ) : (
              <p>In Chrome, tap <b>⋮</b> → <b>Install app</b> (or <b>Add to Home screen</b>). It opens full-screen like an app and works offline.</p>
            )}
          </div>
        </Section>
      )}

      <Section title="Your data">
        <ListCard>
          <button
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-800"
            onClick={async () => {
              const m = await shareBackup();
              if (m) setMsg(m);
            }}
          >
            <NavIcon d={ICONS.upload} className="h-5 w-5 text-brand-bright" />
            <span className="flex-1">
              <span className="block text-[15px] text-ink-100">Export backup</span>
              <span className="block text-xs text-ink-400">Vault, tracked forecasts, PrizePicks lines, settings</span>
            </span>
          </button>
          <button className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-800" onClick={() => fileRef.current?.click()}>
            <NavIcon d={ICONS.download} className="h-5 w-5 text-brand-bright" />
            <span className="flex-1">
              <span className="block text-[15px] text-ink-100">Import backup</span>
              <span className="block text-xs text-ink-400">Merges with what's already on this phone</span>
            </span>
          </button>
          <button
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-800"
            onClick={() => {
              if (confirm("Delete all saved research, tracked forecasts and imported lines from this phone? This can't be undone.")) {
                clearAll();
                setMsg("All saved data deleted from this phone.");
              }
            }}
          >
            <NavIcon d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" className="h-5 w-5 text-neg" />
            <span className="flex-1 text-[15px] text-neg">Delete saved data</span>
          </button>
        </ListCard>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const r = importBackup(await f.text());
              setMsg(`Imported ${r.vault} vault items, ${r.predictions} tracked forecasts and ${r.lines} lines.`);
              refreshData();
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        />
        {msg && <div className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-ink-100">{msg}</div>}
        <p className="px-1 text-[11px] text-ink-500">Everything you save stays on this phone. There's no account and nothing is uploaded.</p>
      </Section>

      <Section title="Stats data">
        <div className="card card-pad space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-ink-400">Source</span><span className="text-ink-100">ESPN public API</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Box scores updated</span><span className="text-ink-100">{meta ? fmtDate(meta.generatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Live scores</span><span className="text-ink-100">Every 20 s while games are on</span></div>
          {meta && (
            <div className="flex justify-between"><span className="text-ink-400">Completed games</span><span className="num text-ink-100">{meta.sports.reduce((a, s) => a + s.finals, 0).toLocaleString()}</span></div>
          )}
          <button
            className="btn mt-2 w-full"
            onClick={async () => {
              resetCaches();
              await provider.loadMeta().catch(() => null);
              setMsg("Checked for new stats.");
              refreshData();
            }}
          >
            Check for new stats
          </button>
          <p className="text-[11px] text-ink-500">Box scores refresh every couple of hours. ESPN's API is public but unofficial — fine for personal research.</p>
        </div>
      </Section>

      <Section title="About">
        <div className="card card-pad space-y-2 text-sm text-ink-300">
          <p><b className="text-white">STATLINE Sports Analytics</b> — Track • Analyze • Win. Your stats. Your insights. Your edge.</p>
          <p className="text-xs">Phone version of the STATLINE desktop app: the same statistics engine, forecasts, Top Plays, Pick and Parlay analyzers, running on your phone. Explanations use the engine's built-in summaries.</p>
        </div>
        <Disclaimer />
      </Section>
    </div>
  );
}
