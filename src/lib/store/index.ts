/**
 * On-device store for the mobile app (replaces the desktop's accounts + database).
 * Research Vault items, tracked forecasts and imported PrizePicks lines are kept in
 * localStorage; screenshots in IndexedDB. Nothing leaves the phone unless the user
 * exports a backup. The method signatures match the desktop Store so shared code is unchanged.
 */
import type { Prediction, PropLine, UploadMeta, VaultItem } from "./types";

const KEY = "sl.store.v1";
export const LOCAL_USER = "local";

interface Data {
  predictions: Prediction[];
  vault: VaultItem[];
  lines: PropLine[];
  uploads: UploadMeta[];
}

const empty = (): Data => ({ predictions: [], vault: [], lines: [], uploads: [] });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const nowIso = () => new Date().toISOString();

let cache: Data | null = null;
const listeners = new Set<() => void>();

function read(): Data {
  if (cache) return cache;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    cache = empty();
  }
  return cache!;
}

export class StorageFullError extends Error {}

function write(d: Data) {
  cache = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch (e) {
    if ((e as Error).name === "QuotaExceededError") throw new StorageFullError("Your phone's storage for this app is full. Export a backup and delete old items.");
    throw e;
  }
  listeners.forEach((l) => l());
}

/** Re-render hooks call this to refresh when anything is saved. */
export function subscribeStore(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------- IndexedDB for screenshots ----------------
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("statline", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("uploads");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(id: string, blob: Blob) {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction("uploads", "readwrite");
    tx.objectStore("uploads").put(blob, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(id: string): Promise<Blob | null> {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = db.transaction("uploads").objectStore("uploads").get(id);
    req.onsuccess = () => res((req.result as Blob) ?? null);
    req.onerror = () => rej(req.error);
  });
}
async function idbDelete(id: string) {
  const db = await idb();
  db.transaction("uploads", "readwrite").objectStore("uploads").delete(id);
}

/** Shrinks a screenshot before storing it (phones produce large images). */
async function shrink(file: Blob, max = 1400): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 600_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

const localStore = {
  kind: "local" as const,

  // predictions (Performance Tracker)
  async createPrediction(p: Omit<Prediction, "id" | "createdAt">): Promise<Prediction> {
    const d = read();
    const rec: Prediction = { ...p, id: uid(), createdAt: nowIso() };
    write({ ...d, predictions: [rec, ...d.predictions] });
    return rec;
  },
  async listPredictions(_userId?: string): Promise<Prediction[]> {
    return read().predictions;
  },
  async updatePrediction(id: string, _userId: string, patch: Partial<Pick<Prediction, "status" | "actual" | "gradedAt" | "note">>) {
    const d = read();
    let out: Prediction | null = null;
    write({ ...d, predictions: d.predictions.map((p) => (p.id === id ? (out = { ...p, ...patch }) : p)) });
    return out;
  },
  async deletePrediction(id: string, _userId?: string) {
    const d = read();
    write({ ...d, predictions: d.predictions.filter((p) => p.id !== id) });
    return true;
  },

  // research vault
  async createVaultItem(v: Omit<VaultItem, "id" | "createdAt" | "updatedAt">): Promise<VaultItem> {
    const d = read();
    const rec: VaultItem = { ...v, id: uid(), createdAt: nowIso(), updatedAt: nowIso() };
    write({ ...d, vault: [rec, ...d.vault] });
    return rec;
  },
  async listVaultItems(_userId?: string) {
    return read().vault;
  },
  async getVaultItem(id: string, _userId?: string) {
    return read().vault.find((v) => v.id === id) ?? null;
  },
  async updateVaultItem(id: string, _userId: string, patch: Partial<Pick<VaultItem, "title" | "notes" | "tags">>) {
    const d = read();
    let out: VaultItem | null = null;
    write({ ...d, vault: d.vault.map((v) => (v.id === id ? (out = { ...v, ...patch, updatedAt: nowIso() }) : v)) });
    return out;
  },
  async deleteVaultItem(id: string, _userId?: string) {
    const d = read();
    const item = d.vault.find((v) => v.id === id);
    if (item?.uploadId) await this.deleteUpload(item.uploadId);
    write({ ...read(), vault: read().vault.filter((v) => v.id !== id) });
    return true;
  },

  // PrizePicks lines (one per player + stat + game; saving replaces)
  async saveLines(_userId: string, lines: Omit<PropLine, "id" | "userId" | "createdAt">[]) {
    const d = read();
    const key = (l: { playerId: string; statKey: string; gameId: string | null }) => `${l.playerId}|${l.statKey}|${l.gameId}`;
    const incoming = new Set(lines.map(key));
    const saved: PropLine[] = lines.map((l) => ({ ...l, id: uid(), userId: LOCAL_USER, createdAt: nowIso() }));
    write({ ...d, lines: [...saved, ...d.lines.filter((l) => !incoming.has(key(l)))] });
    return saved;
  },
  async listLines(_userId?: string) {
    return read().lines;
  },
  async deleteLines(_userId: string, ids?: string[]) {
    const d = read();
    const keep = ids ? d.lines.filter((l) => !ids.includes(l.id)) : [];
    write({ ...d, lines: keep });
    return d.lines.length - keep.length;
  },

  // screenshots
  async saveUpload(file: Blob, filename: string): Promise<UploadMeta> {
    const blob = await shrink(file);
    const meta: UploadMeta = { id: uid(), userId: LOCAL_USER, filename, mimeType: blob.type || "image/jpeg", size: blob.size, createdAt: nowIso() };
    await idbPut(meta.id, blob);
    const d = read();
    write({ ...d, uploads: [meta, ...d.uploads] });
    return meta;
  },
  async getUploadUrl(id: string): Promise<string | null> {
    const b = await idbGet(id).catch(() => null);
    return b ? URL.createObjectURL(b) : null;
  },
  async deleteUpload(id: string) {
    await idbDelete(id).catch(() => {});
    const d = read();
    write({ ...d, uploads: d.uploads.filter((u) => u.id !== id) });
  },
};

export type LocalStore = typeof localStore;
export const getStore = () => localStore;

// ---------------- backup ----------------
export interface Backup {
  app: "statline-mobile";
  version: 1;
  exportedAt: string;
  data: Data;
  settings: Record<string, string | null>;
}

const SETTINGS_KEYS = ["sl.appearance", "sl.sport", "sl.recent"];

export function exportBackup(): Backup {
  return {
    app: "statline-mobile",
    version: 1,
    exportedAt: nowIso(),
    data: read(),
    settings: Object.fromEntries(SETTINGS_KEYS.map((k) => [k, localStorage.getItem(k)])),
  };
}

export function importBackup(json: string): { predictions: number; vault: number; lines: number } {
  const b = JSON.parse(json) as Backup;
  if (b?.app !== "statline-mobile" || !b.data) throw new Error("That file isn't a STATLINE backup.");
  const d = read();
  const merge = <T extends { id: string }>(a: T[], b2: T[] = []) => [...b2.filter((x) => !a.some((y) => y.id === x.id)), ...a];
  const next: Data = {
    predictions: merge(d.predictions, b.data.predictions),
    vault: merge(d.vault, b.data.vault),
    lines: merge(d.lines, b.data.lines),
    uploads: merge(d.uploads, b.data.uploads),
  };
  write(next);
  for (const [k, v] of Object.entries(b.settings ?? {})) if (SETTINGS_KEYS.includes(k) && v != null && !localStorage.getItem(k)) localStorage.setItem(k, v);
  return { predictions: b.data.predictions?.length ?? 0, vault: b.data.vault?.length ?? 0, lines: b.data.lines?.length ?? 0 };
}

export function clearAll() {
  write(empty());
}
