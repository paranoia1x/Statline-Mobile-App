import { useEffect, useState, type FormEvent } from "react";
import { provider } from "@/boot";
import { useSport } from "@/hooks";
import { Section } from "@/components/mobile";
import { EmptyState } from "@/components/ui";
import { recognizeBoxScore } from "@/lib/box-score-ocr";
import { readBoxScore, type BoxScoreTable } from "@/lib/parse/box-score";
import { SPORTS } from "@/lib/sports";
import { SPORT_IDS, type SportId } from "@/lib/types";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export default function BoxScoreScanner() {
  const [selectedSport] = useSport();
  const [sport, setSport] = useState<SportId>(selectedSport ?? "nba");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [tables, setTables] = useState<BoxScoreTable[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const busy = progress !== null;

  async function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setError("");
    setTables(null);
    setProgress(0);
    try {
      const players = await provider.listPlayers({ sport });
      const words = await recognizeBoxScore(file, setProgress);
      setTables(readBoxScore(words, sport, players));
    } catch {
      setError("Couldn’t scan this screenshot. Check your connection and try again with a clear PNG, JPEG, or WebP image.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={scan} className="card space-y-4 p-4">
        <p className="text-sm leading-relaxed text-ink-200">
          Read a box score or fantasy roster from a screenshot. Keep the player-name and stat column headings visible. The image stays on your device.
        </p>
        <div>
          <label htmlFor="scan-sport" className="mb-1.5 block text-sm font-medium text-ink-100">League</label>
          <select
            id="scan-sport"
            className="input w-full"
            disabled={busy}
            value={sport}
            onChange={(event) => {
              setSport(event.target.value as SportId);
              setTables(null);
              setError("");
            }}
          >
            {SPORT_IDS.map((id) => <option key={id} value={id}>{SPORTS[id].name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="scan-image" className="mb-1.5 block text-sm font-medium text-ink-100">Screenshot</label>
          <input
            id="scan-image"
            type="file"
            accept={IMAGE_TYPES.join(",")}
            disabled={busy}
            className="input w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand/20 file:px-2 file:py-1 file:font-medium file:text-ink-100"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setTables(null);
              if (next && next.type && !IMAGE_TYPES.includes(next.type)) {
                setFile(null);
                setError("Choose a PNG, JPEG, or WebP image.");
                event.target.value = "";
                return;
              }
              setFile(next);
              setError("");
            }}
          />
        </div>
        {preview && (
          <img src={preview} alt="Selected screenshot" className="max-h-56 w-full rounded-lg border border-ink-700 bg-ink-950 object-contain" />
        )}
        <button type="submit" disabled={!file || busy} className="btn btn-primary min-h-[44px] w-full disabled:opacity-50">
          {busy ? "Reading screenshot…" : "Read screenshot"}
        </button>
        {busy && (
          <progress className="h-1.5 w-full accent-brand-bright" aria-label="Screenshot scan progress" max={1} value={progress || undefined} />
        )}
        {error && <p role="alert" className="text-sm text-neg">{error}</p>}
      </form>
      {tables && (tables.length ? (
        <Section title="Scan results">
          <p className="text-xs leading-relaxed text-ink-300">
            Compare these results with the screenshot. Only players matched to this league’s roster appear.
          </p>
          {tables.map((table, index) => <Results key={index} table={table} />)}
        </Section>
      ) : (
        <EmptyState title="No matching player rows" body="Check the selected league and try a screenshot that includes the table headings and full player names." />
      ))}
    </div>
  );
}

function Results({ table }: { table: BoxScoreTable }) {
  return (
    <div className="card overflow-x-auto" role="region" aria-label="Scanned player stats" tabIndex={0}>
      <table className="w-full text-sm">
        <thead className="border-b border-ink-700 bg-ink-850 text-ink-300">
          <tr>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-medium">Player</th>
            {table.columns.map((column, index) => (
              <th key={index} scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">
          {table.rows.map((row, index) => (
            <tr key={row.playerId + "-" + index}>
              <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-medium">
                <a href={"#/players/" + row.playerId} className="text-brand-light hover:underline">{row.name}</a>
              </th>
              {row.values.map((value, cellIndex) => (
                <td key={cellIndex} className="num whitespace-nowrap px-3 py-2.5 text-right text-ink-100">{value ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
