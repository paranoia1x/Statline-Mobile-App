import type { ImageAsset } from "@/lib/types";

/**
 * In-memory registry of image assets published by a data provider (e.g. the
 * headshot and logo URLs ESPN returns alongside rosters and teams). Kept apart
 * from statistical data; read by the "provider" ImageProvider.
 */
const g = globalThis as unknown as { __imageRegistry?: Map<string, ImageAsset & { teamId?: string }> };
g.__imageRegistry ??= new Map();

export function registerImage(asset: ImageAsset & { teamId?: string }) {
  g.__imageRegistry!.set(`${asset.entityType}:${asset.entityId}`, asset);
}

export function lookupImage(entityType: "player" | "team", entityId: string) {
  return g.__imageRegistry!.get(`${entityType}:${entityId}`) ?? null;
}
