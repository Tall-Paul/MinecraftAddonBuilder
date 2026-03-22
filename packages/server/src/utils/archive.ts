import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import type { ExtractedPack, PackManifest } from "../models/addon.js";

/**
 * Extract packs from a .mcaddon or .mcpack file.
 * - .mcpack: single pack (behavior or resource) — ZIP containing manifest.json
 * - .mcaddon: multiple packs — ZIP containing .mcpack files or pack directories
 */
export function extractAddon(filePath: string, outputDir: string): ExtractedPack[] {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ext = path.extname(filePath).toLowerCase();
  const zip = new AdmZip(filePath);

  // Check if this is an .mcaddon (contains .mcpack files) or a single .mcpack
  const entries = zip.getEntries();
  console.log(`extractAddon: ${path.basename(filePath)} has ${entries.length} entries`);

  const mcpackEntries = entries.filter((e) =>
    e.entryName.toLowerCase().endsWith(".mcpack")
  );

  if (ext === ".mcaddon" && mcpackEntries.length > 0) {
    // .mcaddon containing .mcpack files
    console.log(`extractAddon: found ${mcpackEntries.length} .mcpack files inside .mcaddon`);
    return extractMcAddon(zip, mcpackEntries, outputDir);
  }

  // Check if manifest.json is at the root — this is a single pack
  const manifestEntry = entries.find(
    (e) =>
      e.entryName === "manifest.json" ||
      e.entryName.endsWith("/manifest.json")
  );

  if (manifestEntry && !entries.some((e) => e.entryName.endsWith("/manifest.json") && e.entryName !== manifestEntry.entryName)) {
    // Only one manifest — single pack
    return extractSinglePack(zip, outputDir, filePath);
  }

  // .mcaddon containing pack directories (no nested .mcpack files)
  // Look for directories that contain manifest.json
  const packDirs = findPackDirectories(entries);
  if (packDirs.length > 0) {
    console.log(`extractAddon: found ${packDirs.length} pack directories: ${packDirs.join(", ")}`);
    return extractPackDirectories(zip, packDirs, outputDir);
  }

  // Last resort: if there's any manifest, try as single pack
  if (manifestEntry) {
    return extractSinglePack(zip, outputDir, filePath);
  }

  console.warn(`Could not identify pack structure in ${filePath}`);
  return [];
}

function extractMcAddon(
  zip: AdmZip,
  mcpackEntries: AdmZip.IZipEntry[],
  outputDir: string
): ExtractedPack[] {
  const packs: ExtractedPack[] = [];

  for (const entry of mcpackEntries) {
    const mcpackData = entry.getData();
    const mcpackName = path.basename(entry.entryName, ".mcpack");
    const mcpackDir = path.join(outputDir, mcpackName);

    console.log(`extractMcAddon: extracting inner .mcpack "${entry.entryName}"`);

    // Write the .mcpack to a temp file and extract it
    const tempPath = path.join(outputDir, path.basename(entry.entryName));
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, mcpackData);

    try {
      const innerZip = new AdmZip(tempPath);
      innerZip.extractAllTo(mcpackDir, true);

      const pack = parsePackDirectory(mcpackDir, mcpackName);
      if (pack) {
        console.log(`extractMcAddon: parsed pack "${pack.name}" type=${pack.type} uuid=${pack.uuid}`);
        packs.push(pack);
      } else {
        console.warn(`extractMcAddon: failed to parse pack from "${entry.entryName}"`);
      }
    } catch (err) {
      console.error(`Failed to extract inner .mcpack ${entry.entryName}:`, err);
    } finally {
      // Clean up temp .mcpack file
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  return packs;
}

function extractSinglePack(
  zip: AdmZip,
  outputDir: string,
  originalPath: string
): ExtractedPack[] {
  const packName = path.basename(originalPath, path.extname(originalPath));
  const packDir = path.join(outputDir, packName);

  zip.extractAllTo(packDir, true);

  const pack = parsePackDirectory(packDir, packName);
  if (pack) {
    console.log(`extractSinglePack: parsed "${pack.name}" type=${pack.type} uuid=${pack.uuid}`);
  }
  return pack ? [pack] : [];
}

function findPackDirectories(entries: AdmZip.IZipEntry[]): string[] {
  const dirs = new Set<string>();

  for (const entry of entries) {
    if (entry.entryName.endsWith("manifest.json")) {
      // Get the directory containing manifest.json
      const dir = entry.entryName.replace(/\/?manifest\.json$/, "");
      if (dir) {
        dirs.add(dir);
        console.log(`findPackDirectories: found manifest at "${entry.entryName}" -> dir "${dir}"`);
      }
    }
  }

  return Array.from(dirs);
}

function extractPackDirectories(
  zip: AdmZip,
  packDirs: string[],
  outputDir: string
): ExtractedPack[] {
  zip.extractAllTo(outputDir, true);

  const packs: ExtractedPack[] = [];
  for (const dir of packDirs) {
    const packPath = path.join(outputDir, dir);
    const pack = parsePackDirectory(packPath, path.basename(dir));
    if (pack) {
      console.log(`extractPackDirectories: parsed "${pack.name}" type=${pack.type} uuid=${pack.uuid}`);
      packs.push(pack);
    }
  }

  return packs;
}

function parsePackDirectory(dirPath: string, fallbackName: string): ExtractedPack | null {
  // Look for manifest.json — could be at root or one level deep
  let manifestPath = path.join(dirPath, "manifest.json");
  let effectiveDirPath = dirPath;

  if (!fs.existsSync(manifestPath)) {
    // Check one level deep
    const subdirs = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const sub of subdirs) {
      if (sub.isDirectory()) {
        const nested = path.join(dirPath, sub.name, "manifest.json");
        if (fs.existsSync(nested)) {
          manifestPath = nested;
          effectiveDirPath = path.join(dirPath, sub.name);
          break;
        }
      }
    }
  }

  if (!fs.existsSync(manifestPath)) {
    console.warn(`No manifest.json found in ${dirPath}`);
    return null;
  }

  try {
    const manifest: PackManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const packType = determinePackType(manifest);

    console.log(`parsePackDirectory: "${manifestPath}" -> modules: ${JSON.stringify(manifest.modules?.map(m => m.type))}, determined type: ${packType}`);

    return {
      name: manifest.header?.name || fallbackName,
      uuid: manifest.header?.uuid || "",
      version: manifest.header?.version || [0, 0, 1],
      type: packType,
      manifest,
      extractedPath: effectiveDirPath,
    };
  } catch (err) {
    console.error(`Failed to parse manifest at ${manifestPath}:`, err);
    return null;
  }
}

function determinePackType(manifest: PackManifest): "behavior" | "resource" {
  // Check modules for type
  for (const mod of manifest.modules || []) {
    if (mod.type === "data" || mod.type === "script") return "behavior";
    if (mod.type === "resources" || mod.type === "client_data") return "resource";
  }
  // Fallback: check if there are textures/models directories referenced
  // or if the header description hints at resource pack
  return "behavior";
}
