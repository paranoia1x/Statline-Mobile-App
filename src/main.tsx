import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { boot } from "./boot";
import { App } from "./App";
import { syncThemeColor } from "./components/AppearancePicker";

const root = createRoot(document.getElementById("root")!);

function Splash({ error }: { error?: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-8 text-center">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={84} height={84} className="h-20 w-20 rounded-2xl shadow-[0_0_30px_rgb(var(--brand)/0.5)]" />
      <div className="text-2xl font-black italic tracking-tight text-white">
        STAT<span className="text-brand-bright">LINE</span>
      </div>
      {error ? (
        <>
          <p className="text-sm text-ink-300">{error}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
        </>
      ) : (
        <p className="text-xs font-semibold uppercase italic tracking-[0.3em] text-ink-400">Track • Analyze • Win</p>
      )}
    </div>
  );
}

root.render(<Splash />);
requestAnimationFrame(syncThemeColor);
boot()
  .then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((e) =>
    root.render(<Splash error={navigator.onLine ? `Couldn't load the stats: ${(e as Error).message}` : "You're offline and the stats haven't been saved on this device yet. Connect once to download them."} />),
  );

// offline support + automatic updates
if ("serviceWorker" in navigator && import.meta.env.PROD) registerSW({ immediate: true });
