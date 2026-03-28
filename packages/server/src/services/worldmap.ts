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

function getMapCachePath(containerId: string, zoom: string): string {
  return path.join(config.cacheDir, `map-${containerId}-z${zoom}.png`);
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

    // Try rendering, starting at zoom 0 and reducing if the world is too large
    const zoomLevels = zoom !== "auto" ? [zoom] : ["0", "-1", "-2", "-3", "-4"];
    let lastError: Error | null = null;

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
        });
        if (stdout) console.log(`worldmap: unmined stdout (last 500): ${stdout.trim().slice(-500)}`);
        if (stderr) console.log(`worldmap: unmined stderr: ${stderr.trim()}`);

        if (fs.existsSync(outputFile)) {
          break; // success
        }
      } catch (err: any) {
        lastError = err;
        const msg = String(err.stderr || err.message || "");
        // Retry at lower zoom if overflow or image too large
        if (msg.includes("OverflowException") || msg.includes("greater than 65535")) {
          console.log(`worldmap: image too large at zoom ${zl}, trying lower zoom`);
          continue;
        }
        throw err; // non-size-related error, don't retry
      }
    }

    if (!fs.existsSync(outputFile)) {
      throw lastError || new Error("unmined-cli did not produce output file");
    }

    const png = fs.readFileSync(outputFile);
    console.log(`worldmap: generated ${(png.length / 1024).toFixed(0)}KB map`);

    // Save to cache
    try {
      fs.mkdirSync(config.cacheDir, { recursive: true });
      fs.writeFileSync(getMapCachePath(containerId, zoom), png);
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
