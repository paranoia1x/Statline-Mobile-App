import path from "node:path";

/**
 * Writable data directory (user accounts, research vault, uploads, ESPN and
 * image caches). Defaults to ./data; the desktop app points DATA_DIR at the
 * user's profile folder so data survives app updates.
 */
export const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), "data");
