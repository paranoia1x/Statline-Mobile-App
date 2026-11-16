import type { SportId } from "@/lib/types";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  settings: { defaultSport?: SportId | "all" };
}

export type PredictionKind = "player_stat" | "game_winner" | "game_total";
export type PredictionStatus = "pending" | "correct" | "incorrect" | "push" | "void";

export interface Prediction {
  id: string;
  userId: string;
  createdAt: string;
  source: "forecast" | "analyzer";
  kind: PredictionKind;
  sport: SportId;
  gameId: string;
  gameDate: string;
  playerId: string | null;
  teamId: string | null;
  opponentId: string | null;
  statKey: string | null;
  threshold: number | null;
  /** over/under for stat & total predictions; home/away/draw for winner predictions. */
  side: "over" | "under" | "home" | "away" | "draw";
  projection: number | null;
  probability: number; // model probability for the tracked side
  confidence: "low" | "medium" | "high";
  modelVersion: string;
  status: PredictionStatus;
  actual: number | null;
  gradedAt: string | null;
  note: string | null;
}

export type VaultItemType = "player" | "team" | "matchup" | "forecast" | "report" | "screenshot" | "note";

export interface VaultItem {
  id: string;
  userId: string;
  type: VaultItemType;
  sport: SportId | null;
  title: string;
  /** Entity references used to render images and links. */
  refs: { playerIds?: string[]; teamIds?: string[]; gameId?: string };
  /** Snapshot of the research (forecast, report, etc.) at save time. */
  payload: unknown;
  notes: string;
  tags: string[];
  uploadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadMeta {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** A pick'em / prop line (e.g. a PrizePicks projection) used as the reference threshold. */
export interface PropLine {
  id: string;
  userId: string;
  source: "prizepicks" | "manual";
  sport: SportId;
  playerId: string;
  statKey: string;
  line: number;
  gameId: string | null;
  gameDate: string | null;
  createdAt: string;
}

export interface Store {
  readonly kind: "json" | "postgres";
  // users
  createUser(u: Omit<User, "id" | "createdAt">): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  updateUserSettings(id: string, settings: User["settings"]): Promise<void>;
  // predictions
  createPrediction(p: Omit<Prediction, "id" | "createdAt">): Promise<Prediction>;
  listPredictions(userId: string): Promise<Prediction[]>;
  updatePrediction(id: string, userId: string, patch: Partial<Pick<Prediction, "status" | "actual" | "gradedAt" | "note">>): Promise<Prediction | null>;
  deletePrediction(id: string, userId: string): Promise<boolean>;
  // vault
  createVaultItem(v: Omit<VaultItem, "id" | "createdAt" | "updatedAt">): Promise<VaultItem>;
  listVaultItems(userId: string): Promise<VaultItem[]>;
  getVaultItem(id: string, userId: string): Promise<VaultItem | null>;
  updateVaultItem(id: string, userId: string, patch: Partial<Pick<VaultItem, "title" | "notes" | "tags">>): Promise<VaultItem | null>;
  deleteVaultItem(id: string, userId: string): Promise<boolean>;
  // prop lines (one per user + player + stat + game; saving replaces)
  saveLines(userId: string, lines: Omit<PropLine, "id" | "userId" | "createdAt">[]): Promise<PropLine[]>;
  listLines(userId: string): Promise<PropLine[]>;
  deleteLines(userId: string, ids?: string[]): Promise<number>;
  // uploads
  saveUpload(meta: Omit<UploadMeta, "id" | "createdAt">, bytes: Buffer): Promise<UploadMeta>;
  getUpload(id: string, userId: string): Promise<{ meta: UploadMeta; bytes: Buffer } | null>;
}
