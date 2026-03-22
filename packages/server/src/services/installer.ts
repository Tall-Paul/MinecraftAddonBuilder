import fs from "fs";
import path from "path";
import tar from "tar-stream";
import { Writable } from "stream";
import { getDockerInstance, execInContainer, getServerDetail, detectBasePath } from "./docker.js";
import { extractAddon } from "../utils/archive.js";
import { getDb } from "../db/index.js";
import { config } from "../config.js";
import type { ExtractedPack } from "../models/addon.js";

interface InstallResult {
  success: boolean;
  installedPacks: Array<{ name: string; uuid: string; type: string }>;
  errors: string[];
}

/**
 * Install an addon into a Bedrock server container.
 * 1. Extract the .mcaddon/.mcpack
 * 2. Copy packs into container via putArchive
 * 3. Update world_*_packs.json registration
 * 4. Record installation in DB
 */
export async function installAddon(
  containerId: string,
  addonFilePath: string,
  addonSource: string,
  addonSourceId: string,
  addonName: string
): Promise<InstallResult> {
  const result: InstallResult = { success: false, installedPacks: [], errors: [] };

  // 1. Get server details (need level name for world packs JSON)
  const server = await getServerDetail(containerId);
  if (!server) {
    result.errors.push(`Server container ${containerId} not found`);
    return result;
  }

  if (server.status !== "running") {
    result.errors.push(`Server container ${containerId} is not running`);
    return result;
  }

  const levelName = server.levelName || "Bedrock level";

  // 2. Extract the addon
  const extractDir = path.join(config.cacheDir, `extract-${Date.now()}`);
  let packs: ExtractedPack[];
  try {
    packs = extractAddon(addonFilePath, extractDir);
  } catch (err) {
    result.errors.push(`Failed to extract addon: ${err}`);
    return result;
  }

  if (packs.length === 0) {
    result.errors.push("No valid packs found in addon file");
    cleanup(extractDir);
    return result;
  }

  const docker = getDockerInstance();
  const container = docker.getContainer(containerId);

  // Detect the server's base data path
  const basePath = await detectBasePath(container);

  // 3. Copy each pack into the container and register it
  for (const pack of packs) {
    try {
      const targetDir =
        pack.type === "behavior" ? `${basePath}/behavior_packs` : `${basePath}/resource_packs`;

      // Create a tar archive of the pack directory
      const tarBuffer = await createTarFromDirectory(pack.extractedPath, pack.name);

      // Upload to container
      await container.putArchive(tarBuffer, { path: targetDir });

      // Register in the world packs JSON
      const packsJsonFile =
        pack.type === "behavior"
          ? "world_behavior_packs.json"
          : "world_resource_packs.json";

      const packsJsonPath = `${basePath}/worlds/${levelName}/${packsJsonFile}`;

      await registerPack(container, packsJsonPath, pack.uuid, pack.version);

      // Register in valid_known_packs.json so the server pushes packs to clients
      await registerValidKnownPack(container, basePath, pack);

      result.installedPacks.push({
        name: pack.name,
        uuid: pack.uuid,
        type: pack.type,
      });
    } catch (err) {
      result.errors.push(`Failed to install pack "${pack.name}": ${err}`);
    }
  }

  // 4. Record installation in database
  if (result.installedPacks.length > 0) {
    result.success = true;
    const db = getDb();
    db.prepare(
      `INSERT INTO installations (container_id, container_name, addon_source, addon_source_id, addon_name, packs)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      containerId,
      server.containerName,
      addonSource,
      addonSourceId,
      addonName,
      JSON.stringify(result.installedPacks)
    );
  }

  // Cleanup extracted files
  cleanup(extractDir);

  return result;
}

/**
 * Uninstall a previously installed addon from a server.
 */
export async function uninstallAddon(
  containerId: string,
  installationId: number
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const installation = db
    .prepare("SELECT * FROM installations WHERE id = ? AND container_id = ?")
    .get(installationId, containerId) as any;

  if (!installation) {
    return { success: false, error: "Installation record not found" };
  }

  const server = await getServerDetail(containerId);
  if (!server || server.status !== "running") {
    return { success: false, error: "Server not found or not running" };
  }

  const levelName = server.levelName || "Bedrock level";
  const docker = getDockerInstance();
  const container = docker.getContainer(containerId);
  const basePath = await detectBasePath(container);
  const packs = JSON.parse(installation.packs) as Array<{
    name: string;
    uuid: string;
    type: string;
  }>;

  for (const pack of packs) {
    try {
      // Remove pack directory from container
      const targetDir =
        pack.type === "behavior" ? `${basePath}/behavior_packs` : `${basePath}/resource_packs`;
      await execInContainer(container, ["rm", "-rf", `${targetDir}/${pack.name}`]);

      // Unregister from world packs JSON
      const packsJsonFile =
        pack.type === "behavior"
          ? "world_behavior_packs.json"
          : "world_resource_packs.json";
      const packsJsonPath = `${basePath}/worlds/${levelName}/${packsJsonFile}`;
      await unregisterPack(container, packsJsonPath, pack.uuid);

      // Unregister from valid_known_packs.json
      await unregisterValidKnownPack(container, basePath, pack.uuid);
    } catch (err) {
      console.error(`Error removing pack ${pack.name}:`, err);
    }
  }

  // Remove installation record
  db.prepare("DELETE FROM installations WHERE id = ?").run(installationId);

  return { success: true };
}

async function registerPack(
  container: any,
  jsonPath: string,
  uuid: string,
  version: [number, number, number]
): Promise<void> {
  // Read current packs JSON
  let currentPacks: Array<{ pack_id: string; version: number[] }> = [];

  const content = await execInContainer(container, ["cat", jsonPath]);
  if (content) {
    try {
      currentPacks = JSON.parse(content);
    } catch { /* start fresh */ }
  }

  // Check if already registered
  if (currentPacks.some((p) => p.pack_id === uuid)) {
    return;
  }

  // Add the new pack
  currentPacks.push({
    pack_id: uuid,
    version: Array.from(version),
  });

  // Write back via putting a tar archive with the updated JSON
  const jsonContent = JSON.stringify(currentPacks, null, 2);
  const dir = path.posix.dirname(jsonPath);
  const filename = path.posix.basename(jsonPath);

  const tarBuffer = await createTarFromContent(filename, jsonContent);
  await container.putArchive(tarBuffer, { path: dir });
}

async function unregisterPack(
  container: any,
  jsonPath: string,
  uuid: string
): Promise<void> {
  const content = await execInContainer(container, ["cat", jsonPath]);
  if (!content) return;

  let currentPacks: Array<{ pack_id: string; version: number[] }>;
  try {
    currentPacks = JSON.parse(content);
  } catch {
    return;
  }

  const filtered = currentPacks.filter((p) => p.pack_id !== uuid);
  const jsonContent = JSON.stringify(filtered, null, 2);

  const dir = path.posix.dirname(jsonPath);
  const filename = path.posix.basename(jsonPath);

  const tarBuffer = await createTarFromContent(filename, jsonContent);
  await container.putArchive(tarBuffer, { path: dir });
}

/**
 * Register a pack in valid_known_packs.json so the server sends it to clients.
 */
async function registerValidKnownPack(
  container: any,
  basePath: string,
  pack: ExtractedPack
): Promise<void> {
  const vkpPath = `${basePath}/valid_known_packs.json`;
  let knownPacks: Array<{ file_system: string; path: string; uuid: string; version: string }> = [];

  const content = await execInContainer(container, ["cat", vkpPath]);
  if (content) {
    try {
      knownPacks = JSON.parse(content);
    } catch { /* start fresh */ }
  }

  // Check if already registered
  if (knownPacks.some((p) => p.uuid === pack.uuid)) {
    return;
  }

  const packSubDir = pack.type === "behavior" ? "behavior_packs" : "resource_packs";
  knownPacks.push({
    file_system: "RawPath",
    path: `${packSubDir}/${pack.name}`,
    uuid: pack.uuid,
    version: pack.version.join("."),
  });

  const jsonContent = JSON.stringify(knownPacks, null, 2);
  const tarBuffer = await createTarFromContent("valid_known_packs.json", jsonContent);
  await container.putArchive(tarBuffer, { path: basePath });
}

/**
 * Remove a pack from valid_known_packs.json.
 */
async function unregisterValidKnownPack(
  container: any,
  basePath: string,
  uuid: string
): Promise<void> {
  const vkpPath = `${basePath}/valid_known_packs.json`;
  const content = await execInContainer(container, ["cat", vkpPath]);
  if (!content) return;

  let knownPacks: Array<{ file_system: string; path: string; uuid: string; version: string }>;
  try {
    knownPacks = JSON.parse(content);
  } catch {
    return;
  }

  const filtered = knownPacks.filter((p) => p.uuid !== uuid);
  const jsonContent = JSON.stringify(filtered, null, 2);
  const tarBuffer = await createTarFromContent("valid_known_packs.json", jsonContent);
  await container.putArchive(tarBuffer, { path: basePath });
}

function createTarFromDirectory(dirPath: string, packName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];

    const collector = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    collector.on("finish", () => resolve(Buffer.concat(chunks)));
    pack.pipe(collector);

    addDirectoryToTar(pack, dirPath, packName);

    pack.finalize();
  });
}

function addDirectoryToTar(pack: tar.Pack, dirPath: string, prefix: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  // Add directory entry
  pack.entry({ name: prefix + "/", type: "directory" });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const tarPath = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      addDirectoryToTar(pack, fullPath, tarPath);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath);
      pack.entry({ name: tarPath, size: content.length }, content);
    }
  }
}

function createTarFromContent(filename: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];

    const collector = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    collector.on("finish", () => resolve(Buffer.concat(chunks)));
    pack.pipe(collector);

    const buf = Buffer.from(content, "utf-8");
    pack.entry({ name: filename, size: buf.length }, buf);
    pack.finalize();
  });
}

function cleanup(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Best effort cleanup
  }
}

export function getInstallations(containerId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM installations WHERE container_id = ? ORDER BY installed_at DESC")
    .all(containerId);
}
