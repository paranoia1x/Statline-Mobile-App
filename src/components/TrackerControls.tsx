"use client";

import { apiFetch } from "@/lib/api";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GradeNow() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await apiFetch("/api/predictions/grade", { method: "POST" });
          const d = await r.json().catch(() => ({}));
          setBusy(false);
          setMsg(r.ok ? `${d.graded} graded` : d.error ?? "Grading failed");
          router.refresh();
        }}
      >
        {busy ? "Grading…" : "Grade finished games"}
      </button>
      {msg && <span className="text-xs text-ink-400">{msg}</span>}
    </span>
  );
}

export function WithdrawPrediction({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-xs text-ink-400 hover:text-neg"
      disabled={busy}
      title="Pending forecasts can be withdrawn before the game; graded ones are permanent."
      onClick={async () => {
        setBusy(true);
        await apiFetch(`/api/predictions/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      {busy ? "…" : "Withdraw"}
    </button>
  );
}
