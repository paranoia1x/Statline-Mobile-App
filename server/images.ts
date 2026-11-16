import fs from "node:fs";
import path from "node:path";
import type { ImageAsset, Player, Team } from "@/lib/types";
import { lookupImage } from "@/lib/images/registry";
import { dataDir } from "./paths";

/**
 * IMAGE SYSTEM
 * Image data is kept separate from statistical data. A provider resolves an
 * ImageAsset (url + source + verification status + last update) for an entity.
 * Only `verified` assets are ever displayed; everything else falls back to a
 * neutral placeholder. We never substitute a different person's photo.
 */
export interface ImageProvider {
  readonly id: string;
  readonly name: string;
  getPlayerImage(player: Player): ImageAsset;
  getTeamLogo(team: Team): ImageAsset;
}

const unavailable = (entityType: "player" | "team", entityId: string): ImageAsset => ({
  entityType,
  entityId,
  url: null,
  source: null,
  verification: "unavailable",
  updatedAt: null,
});

/** Default: no licensed image source configured -> neutral placeholders everywhere. */
export class PlaceholderImageProvider implements ImageProvider {
  readonly id = "none";
  readonly name = "Neutral placeholders (no image provider configured)";
  getPlayerImage(p: Player) {
    return unavailable("player", p.id);
  }
  getTeamLogo(t: Team) {
    return unavailable("team", t.id);
  }
}

interface ManifestEntry {
  entityType: "player" | "team";
  entityId: string;
  url: string;
  source: string;
  verification: "verified" | "unverified";
  updatedAt: string;
  /** For player headshots: the team the photo was verified for. */
  teamId?: string;
}

/**
 * Manifest provider: reads a JSON list of licensed/authorised image URLs
 * (e.g. exported from an official data provider) from IMAGE_MANIFEST_PATH.
 * A headshot whose verified team no longer matches the player's current team
 * is downgraded to `unverified` and not shown.
 */
export class ManifestImageProvider implements ImageProvider {
  readonly id = "manifest";
  readonly name: string;
  private entries = new Map<string, ManifestEntry>();
  constructor(file: string) {
    this.name = `Image manifest (${path.basename(file)})`;
    try {
      const list = JSON.parse(fs.readFileSync(file, "utf8")) as ManifestEntry[];
      for (const e of list) this.entries.set(`${e.entityType}:${e.entityId}`, e);
    } catch (err) {
      console.warn(`[images] Could not read image manifest ${file}:`, (err as Error).message);
    }
  }
  getPlayerImage(p: Player): ImageAsset {
    const e = this.entries.get(`player:${p.id}`);
    if (!e) return unavailable("player", p.id);
    const teamMismatch = e.teamId && e.teamId !== p.teamId;
    return {
      entityType: "player",
      entityId: p.id,
      url: e.url,
      source: e.source,
      verification: teamMismatch ? "unverified" : e.verification,
      updatedAt: e.updatedAt,
    };
  }
  getTeamLogo(t: Team): ImageAsset {
    const e = this.entries.get(`team:${t.id}`);
    if (!e) return unavailable("team", t.id);
    return { entityType: "team", entityId: t.id, url: e.url, source: e.source, verification: e.verification, updatedAt: e.updatedAt };
  }
}

/**
 * Provider-published images: headshots and logos returned by the active data
 * provider's official API (e.g. ESPN rosters/teams). A headshot is only
 * "verified" when it was published on the roster of the player's current team.
 */
export class RegistryImageProvider implements ImageProvider {
  readonly id = "provider";
  readonly name = "Data-provider images (ESPN headshots & logos)";
  getPlayerImage(p: Player): ImageAsset {
    const a = lookupImage("player", p.id);
    if (!a?.url) return unavailable("player", p.id);
    return { ...a, verification: a.teamId && a.teamId !== p.teamId ? "unverified" : a.verification };
  }
  getTeamLogo(t: Team): ImageAsset {
    return lookupImage("team", t.id) ?? unavailable("team", t.id);
  }
}

const g = globalThis as unknown as { __imageProvider?: ImageProvider };

export function getImageProvider(): ImageProvider {
  if (!g.__imageProvider) {
    const dataProvider = (process.env.SPORTS_DATA_PROVIDER || "espn").toLowerCase();
    const kind = (process.env.IMAGE_PROVIDER || (dataProvider === "demo" ? "none" : "provider")).toLowerCase();
    if (kind === "provider") {
      g.__imageProvider = new RegistryImageProvider();
    } else if (kind === "manifest") {
      g.__imageProvider = new ManifestImageProvider(process.env.IMAGE_MANIFEST_PATH || path.join(dataDir(), "image-manifest.json"));
    } else {
      g.__imageProvider = new PlaceholderImageProvider();
    }
  }
  return g.__imageProvider;
}

/** URL the browser should load, routed through the caching proxy. Null => placeholder. */
export function displayUrl(asset: ImageAsset | null | undefined): string | null {
  if (!asset || !asset.url || asset.verification !== "verified") return null;
  return `/api/image?src=${encodeURIComponent(asset.url)}`;
}

export function playerImageUrl(p: Player): string | null {
  return displayUrl(getImageProvider().getPlayerImage(p));
}
export function teamLogoUrl(t: Team): string | null {
  return displayUrl(getImageProvider().getTeamLogo(t));
}
