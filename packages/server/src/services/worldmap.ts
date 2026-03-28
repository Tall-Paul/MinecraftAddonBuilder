import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import tar from "tar-stream";
import { getDockerInstance, getServerDetail, detectBasePath, listBedrockServers } from "./docker.js";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

const UNMINED_CLI = process.env.UNMINED_CLI || "/opt/unmined-cli/unmined-cli";

export interface MapMeta {
  zoomLevel: number;
  imageWidth: number;
  imageHeight: number;
  // Block-coordinate bounds of the rendered (trimmed) image.
  // Top-left of the image corresponds to (blockMinX, blockMinZ).
  blockMinX: number;
  blockMinZ: number;
  blockMaxX: number;
  blockMaxZ: number;
}

function getMapCachePath(containerId: string, zoom: string): string {
  return path.join(config.cacheDir, `map-${containerId}-z${zoom}.png`);
}

function getMapMetaPath(containerId: string, zoom: string): string {
  return path.join(config.cacheDir, `map-${containerId}-z${zoom}.json`);
}

/** Read PNG width/height from the IHDR chunk (bytes 16-23). */
function readPngDimensions(buf: Buffer): { width: number; height: number } {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * Parse unmined-cli stdout to extract the region coordinates and trimmed image size.
 * Regions are logged as "Rendering region rr(X; Z)".
 * Trimming is logged as "Trimming output image to W x H pixels".
 * Each region = 512x512 blocks. The full (untrimmed) render covers all regions.
 * Returns the block-coordinate bounds of the trimmed image.
 */
function parseWorldBounds(
  stdout: string,
  zoomLevel: number,
  trimmedWidth: number,
  trimmedHeight: number,
): { blockMinX: number; blockMinZ: number; blockMaxX: number; blockMaxZ: number } {
  // Parse all region coordinates
  const regionRegex = /rr\((-?\d+);\s*(-?\d+)\)/g;
  let match;
  let minRX = Infinity, maxRX = -Infinity, minRZ = Infinity, maxRZ = -Infinity;
  let found = false;

  while ((match = regionRegex.exec(stdout)) !== null) {
    const rx = parseInt(match[1], 10);
    const rz = parseInt(match[2], 10);
    if (rx < minRX) minRX = rx;
    if (rx > maxRX) maxRX = rx;
    if (rz < minRZ) minRZ = rz;
    if (rz > maxRZ) maxRZ = rz;
    found = true;
  }

  if (!found) {
    // Fallback: assume centered on (0,0)
    const bpp = Math.pow(2, -zoomLevel);
    const halfW = (trimmedWidth * bpp) / 2;
    const halfH = (trimmedHeight * bpp) / 2;
    return {
      blockMinX: Math.round(-halfW),
      blockMinZ: Math.round(-halfH),
      blockMaxX: Math.round(halfW),
      blockMaxZ: Math.round(halfH),
    };
  }

  // Each region is 512x512 blocks. Full render spans all regions.
  const REGION_BLOCKS = 512;
  const fullBlockMinX = minRX * REGION_BLOCKS;
  const fullBlockMinZ = minRZ * REGION_BLOCKS;
  const fullBlockMaxX = (maxRX + 1) * REGION_BLOCKS;
  const fullBlockMaxZ = (maxRZ + 1) * REGION_BLOCKS;

  // Full image size at this zoom level (pixels)
  const bpp = Math.pow(2, -zoomLevel);
  const fullWidthPx = (fullBlockMaxX - fullBlockMinX) / bpp;
  const fullHeightPx = (fullBlockMaxZ - fullBlockMinZ) / bpp;

  // Trimming removes equal amounts from each side
  const trimLeftPx = (fullWidthPx - trimmedWidth) / 2;
  const trimTopPx = (fullHeightPx - trimmedHeight) / 2;

  return {
    blockMinX: Math.round(fullBlockMinX + trimLeftPx * bpp),
    blockMinZ: Math.round(fullBlockMinZ + trimTopPx * bpp),
    blockMaxX: Math.round(fullBlockMinX + (trimLeftPx + trimmedWidth) * bpp),
    blockMaxZ: Math.round(fullBlockMinZ + (trimTopPx + trimmedHeight) * bpp),
  };
}

/**
 * Get a cached map if it exists.
 */
export function getCachedMap(containerId: string, zoom: string): Buffer | null {
  const cachePath = getMapCachePath(containerId, zoom);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }
  return null;
}

/**
 * Get the metadata (zoom level, image dimensions) for a cached overview map.
 */
export function getCachedMapMeta(containerId: string, zoom: string = "auto"): MapMeta | null {
  const metaPath = getMapMetaPath(containerId, zoom);
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch { return null; }
  }
  return null;
}

/**
 * Generate a PNG map of the world using unmined-cli.
 * Saves to cache after generation.
 */
export async function generateWorldMap(
  containerId: string,
  zoom: string = "auto"
): Promise<Buffer> {
  const server = await getServerDetail(containerId);
  if (!server) throw new Error("Server not found");

  const docker = getDockerInstance();
  const container = docker.getContainer(containerId);
  const basePath = await detectBasePath(container);
  const levelName = server.levelName || "Bedrock level";
  const worldPath = `${basePath}/worlds/${levelName}`;

  const tempDir = path.join(os.tmpdir(), `mcmap-${containerId}-${Date.now()}`);
  const worldDir = path.join(tempDir, "world");
  const outputFile = path.join(tempDir, "map.png");

  try {
    console.log(`worldmap: extracting world from ${worldPath}`);
    await extractFromContainer(container, worldPath, worldDir);

    console.log(`worldmap: running unmined-cli`);

    // Try rendering, starting at zoom 0 and reducing if the world is too large.
    // unmined crashes with various exceptions (Overflow, ArgumentException, etc.)
    // when the output image exceeds limits, so retry at lower zoom on any SIGABRT/crash.
    const zoomLevels = zoom !== "auto" ? [zoom] : ["0", "-1", "-2", "-3", "-4", "-5"];
    let lastError: Error | null = null;
    let usedZoom = zoomLevels[0];
    let lastStdout = "";

    for (const zl of zoomLevels) {
      try {
        // Clean up previous attempt's output
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

        const args = [
          "image", "render",
          "--world", worldDir,
          "--output", outputFile,
          "--trim",
          "--zoom", zl,
        ];

        console.log(`worldmap: trying zoom level ${zl}`);
        const { stdout, stderr } = await execFileAsync(UNMINED_CLI, args, {
          timeout: 180_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        if (stdout) console.log(`worldmap: unmined stdout (last 500): ${stdout.trim().slice(-500)}`);
        if (stderr) console.log(`worldmap: unmined stderr: ${stderr.trim()}`);

        if (fs.existsSync(outputFile)) {
          usedZoom = zl;
          lastStdout = stdout || "";
          break; // success
        }
      } catch (err: any) {
        lastError = err;
        // If unmined crashed (SIGABRT, non-zero exit), retry at lower zoom
        // Only bail out on timeouts or Node-level spawn errors
        if (err.killed || err.code === "ETIMEDOUT" || err.code === "ENOENT") {
          throw err;
        }
        console.log(`worldmap: unmined crashed at zoom ${zl}, trying lower zoom`);
        continue;
      }
    }

    if (!fs.existsSync(outputFile)) {
      throw lastError || new Error("unmined-cli did not produce output file");
    }

    const png = fs.readFileSync(outputFile);
    console.log(`worldmap: generated ${(png.length / 1024).toFixed(0)}KB map at zoom ${usedZoom}`);

    // Save PNG and metadata sidecar to cache
    try {
      fs.mkdirSync(config.cacheDir, { recursive: true });
      fs.writeFileSync(getMapCachePath(containerId, zoom), png);

      const dims = readPngDimensions(png);
      const zl = parseInt(usedZoom, 10);
      const bounds = parseWorldBounds(lastStdout, zl, dims.width, dims.height);
      const meta: MapMeta = {
        zoomLevel: zl,
        imageWidth: dims.width,
        imageHeight: dims.height,
        ...bounds,
      };
      console.log(`worldmap: meta bounds blockX=[${bounds.blockMinX},${bounds.blockMaxX}] blockZ=[${bounds.blockMinZ},${bounds.blockMaxZ}]`);
      fs.writeFileSync(getMapMetaPath(containerId, zoom), JSON.stringify(meta));
    } catch { /* best effort */ }

    return png;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
  }
}

/**
 * Pre-generate maps for all running servers (non-blocking).
 */
export async function preGenerateMaps(): Promise<void> {
  const servers = await listBedrockServers();
  const running = servers.filter((s) => s.status === "running");
  console.log(`worldmap: pre-generating maps for ${running.length} running server(s)`);

  for (const server of running) {
    try {
      await generateWorldMap(server.containerId, "auto");
      console.log(`worldmap: cached map for ${server.containerName}`);
    } catch (err: any) {
      console.log(`worldmap: skipping ${server.containerName}: ${err.message}`);
    }
  }
}

/**
 * Generate a zoomed-in PNG map of a specific block area.
 * Does not cache — these are on-demand renders.
 */
export async function generateZoomedMap(
  containerId: string,
  blockX: number,
  blockZ: number,
  blockW: number,
  blockH: number,
  zoom: string = "0"
): Promise<Buffer> {
  const server = await getServerDetail(containerId);
  if (!server) throw new Error("Server not found");

  const docker = getDockerInstance();
  const container = docker.getContainer(containerId);
  const basePath = await detectBasePath(container);
  const levelName = server.levelName || "Bedrock level";
  const worldPath = `${basePath}/worlds/${levelName}`;

  const tempDir = path.join(os.tmpdir(), `mcmap-zoom-${containerId}-${Date.now()}`);
  const worldDir = path.join(tempDir, "world");
  const outputFile = path.join(tempDir, "map.png");

  try {
    console.log(`worldmap: extracting world for zoomed render`);
    await extractFromContainer(container, worldPath, worldDir);

    const areaArg = `b(${blockX},${blockZ},${blockW},${blockH})`;
    const args = [
      "image", "render",
      "--world", worldDir,
      "--output", outputFile,
      "--zoom", zoom,
      "--area", areaArg,
    ];

    console.log(`worldmap: zoomed render area=${areaArg} zoom=${zoom}`);
    const { stdout, stderr } = await execFileAsync(UNMINED_CLI, args, {
      timeout: 180_000,
    });
    if (stdout) console.log(`worldmap: unmined stdout (last 500): ${stdout.trim().slice(-500)}`);
    if (stderr) console.log(`worldmap: unmined stderr: ${stderr.trim()}`);

    if (!fs.existsSync(outputFile)) {
      throw new Error("unmined-cli did not produce output file for zoomed render");
    }

    const png = fs.readFileSync(outputFile);
    console.log(`worldmap: zoomed render ${(png.length / 1024).toFixed(0)}KB`);
    return png;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
  }
}

/**
 * Extract a directory from a Docker container using getArchive.
 */
async function extractFromContainer(
  container: any,
  containerPath: string,
  localDir: string
): Promise<void> {
  fs.mkdirSync(localDir, { recursive: true });

  const stream = await container.getArchive({ path: containerPath });

  return new Promise((resolve, reject) => {
    const extract = tar.extract();

    extract.on("entry", (header, entryStream, next) => {
      const parts = header.name.split("/");
      parts.shift(); // strip leading dir name
      const relativePath = parts.join("/");

      if (!relativePath || header.type === "directory") {
        entryStream.resume();
        next();
        return;
      }

      const filePath = path.join(localDir, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      const writeStream = fs.createWriteStream(filePath);
      entryStream.pipe(writeStream);
      writeStream.on("finish", next);
      writeStream.on("error", next);
    });

    extract.on("finish", resolve);
    extract.on("error", reject);

    stream.pipe(extract);
  });
}
