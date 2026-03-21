import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { getDb } from "../db/index.js";

/**
 * Download an addon file to the local cache.
 * Returns the path to the cached file.
 */
export async function downloadAddon(
  url: string,
  source: string,
  sourceId: string,
  name: string
): Promise<string> {
  if (!fs.existsSync(config.cacheDir)) {
    fs.mkdirSync(config.cacheDir, { recursive: true });
  }

  // Check if already cached
  const db = getDb();
  const cached = db
    .prepare("SELECT file_path FROM addon_cache WHERE source = ? AND source_id = ?")
    .get(source, sourceId) as { file_path: string } | undefined;

  if (cached && fs.existsSync(cached.file_path)) {
    return cached.file_path;
  }

  // Download the file
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "MinecraftAddonBuilder/1.0 (https://github.com/minecraft-addon-builder)",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  // Determine filename from Content-Disposition header or URL
  let filename = getFilenameFromResponse(res, url);
  // Ensure it has a Bedrock addon extension
  if (
    !filename.endsWith(".mcpack") &&
    !filename.endsWith(".mcaddon") &&
    !filename.endsWith(".zip")
  ) {
    filename += ".mcaddon";
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(config.cacheDir, `${source}-${sourceId}-${safeName}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  // Update cache record
  db.prepare(
    "INSERT OR REPLACE INTO addon_cache (source, source_id, name, file_path) VALUES (?, ?, ?, ?)"
  ).run(source, sourceId, name, filePath);

  return filePath;
}

function getFilenameFromResponse(res: Response, url: string): string {
  const disposition = res.headers.get("content-disposition");
  if (disposition) {
    const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';\n]+)/i);
    if (match) return decodeURIComponent(match[1]);
  }

  // Fall back to URL path
  const urlPath = new URL(url).pathname;
  return path.basename(urlPath) || "addon";
}

/**
 * Save a manually uploaded addon file to cache.
 */
export function saveUploadedAddon(
  fileBuffer: Buffer,
  originalName: string,
  source: string,
  sourceId: string
): string {
  if (!fs.existsSync(config.cacheDir)) {
    fs.mkdirSync(config.cacheDir, { recursive: true });
  }

  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(config.cacheDir, `upload-${Date.now()}-${safeName}`);
  fs.writeFileSync(filePath, fileBuffer);

  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO addon_cache (source, source_id, name, file_path) VALUES (?, ?, ?, ?)"
  ).run(source, sourceId, originalName, filePath);

  return filePath;
}
