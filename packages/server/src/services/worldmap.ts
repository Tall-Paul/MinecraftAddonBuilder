import fs from "fs";
import os from "os";
import path from "path";
import { Writable } from "stream";
import tar from "tar-stream";
import { PNG } from "pngjs";
import { getDockerInstance, getServerDetail, detectBasePath } from "./docker.js";

// Bedrock biome ID -> RGB color mapping
const BIOME_COLORS: Record<number, [number, number, number]> = {
  0: [0, 0, 112],        // Ocean
  1: [141, 179, 96],      // Plains
  2: [250, 148, 24],      // Desert
  3: [96, 96, 96],        // Extreme Hills
  4: [5, 102, 33],        // Forest
  5: [11, 102, 89],       // Taiga
  6: [7, 249, 178],       // Swampland
  7: [0, 0, 255],         // River
  8: [255, 0, 0],         // Nether (Hell)
  9: [128, 128, 255],     // The End
  10: [144, 144, 160],    // Frozen Ocean
  11: [160, 160, 255],    // Frozen River
  12: [255, 255, 255],    // Ice Plains (Snowy Tundra)
  13: [160, 160, 160],    // Ice Mountains
  14: [255, 0, 255],      // Mushroom Island
  15: [160, 0, 255],      // Mushroom Island Shore
  16: [250, 222, 85],     // Beach
  17: [210, 95, 18],      // Desert Hills
  18: [34, 85, 28],       // Forest Hills
  19: [22, 57, 51],       // Taiga Hills
  20: [114, 120, 154],    // Extreme Hills Edge
  21: [83, 123, 9],       // Jungle
  22: [44, 66, 5],        // Jungle Hills
  23: [98, 139, 23],      // Jungle Edge
  24: [0, 0, 48],         // Deep Ocean
  25: [162, 162, 132],    // Stone Beach
  26: [250, 240, 192],    // Cold Beach
  27: [48, 116, 68],      // Birch Forest
  28: [31, 95, 50],       // Birch Forest Hills
  29: [64, 81, 26],       // Dark Forest (Roofed Forest)
  30: [49, 85, 74],       // Cold Taiga
  31: [36, 63, 54],       // Cold Taiga Hills
  32: [89, 102, 56],      // Mega Taiga
  33: [69, 79, 62],       // Mega Taiga Hills
  34: [80, 112, 80],      // Extreme Hills+
  35: [189, 178, 95],     // Savanna
  36: [167, 157, 100],    // Savanna Plateau
  37: [217, 69, 21],      // Mesa (Badlands)
  38: [176, 151, 101],    // Mesa Plateau F
  39: [202, 140, 101],    // Mesa Plateau
  40: [0, 0, 172],        // Warm Ocean (1.4+)
  41: [32, 32, 112],      // Lukewarm Ocean
  42: [64, 64, 144],      // Cold Ocean
  43: [0, 0, 80],         // Deep Warm Ocean
  44: [0, 0, 64],         // Deep Lukewarm Ocean
  45: [32, 32, 56],       // Deep Cold Ocean
  46: [32, 32, 112],      // Deep Frozen Ocean
  47: [0, 0, 0],          // Legacy Frozen Ocean
  127: [0, 0, 0],         // The Void

  // Mutated variants
  129: [176, 220, 128],   // Sunflower Plains
  130: [230, 168, 60],    // Desert M
  131: [120, 120, 120],   // Extreme Hills M
  132: [37, 130, 48],     // Flower Forest
  133: [51, 142, 129],    // Taiga M
  134: [47, 255, 218],    // Swampland M
  140: [180, 220, 220],   // Ice Plains Spikes
  149: [109, 159, 35],    // Jungle M
  151: [138, 179, 63],    // Jungle Edge M
  155: [75, 145, 95],     // Birch Forest M
  156: [57, 120, 75],     // Birch Forest Hills M
  157: [96, 121, 66],     // Dark Forest M (Roofed Forest M)
  158: [89, 125, 114],    // Cold Taiga M
  160: [129, 142, 96],    // Mega Spruce Taiga
  161: [109, 119, 102],   // Mega Spruce Taiga Hills
  162: [120, 152, 120],   // Extreme Hills+ M
  163: [229, 218, 135],   // Savanna M
  164: [207, 197, 140],   // Savanna Plateau M
  165: [247, 109, 61],    // Mesa Bryce
  166: [216, 191, 141],   // Mesa Plateau F M
  167: [242, 180, 141],   // Mesa Plateau M

  // Cherry, mangrove, deep dark, etc. (newer)
  168: [255, 167, 189],   // Cherry Grove
  169: [52, 105, 32],     // Mangrove Swamp
  190: [17, 20, 41],      // Deep Dark
};

const DEFAULT_COLOR: [number, number, number] = [128, 128, 128];

interface ChunkInfo {
  x: number;
  z: number;
  biome: number;
}

/**
 * Generate a PNG map of explored chunks with biome colors.
 */
export async function generateWorldMap(
  containerId: string,
  scale: number = 2
): Promise<Buffer> {
  const server = await getServerDetail(containerId);
  if (!server) throw new Error("Server not found");

  const docker = getDockerInstance();
  const container = docker.getContainer(containerId);
  const basePath = await detectBasePath(container);
  const levelName = server.levelName || "Bedrock level";
  const dbPath = `${basePath}/worlds/${levelName}/db`;

  // Extract LevelDB from container to temp directory
  const tempDir = path.join(os.tmpdir(), `mcmap-${containerId}-${Date.now()}`);

  try {
    console.log(`worldmap: extracting LevelDB from ${dbPath}`);
    await extractFromContainer(container, dbPath, tempDir);

    console.log(`worldmap: parsing chunks`);
    const chunks = await parseChunks(tempDir);
    console.log(`worldmap: found ${chunks.length} chunks`);

    if (chunks.length === 0) {
      throw new Error("No chunks found in world data");
    }

    console.log(`worldmap: rendering PNG`);
    const png = renderMap(chunks, scale);
    return png;
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
  }
}

/**
 * Extract a directory from a Docker container to a local path using getArchive.
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
      // Strip the leading directory name from the tar path
      // getArchive wraps in the directory name (e.g., "db/000001.ldb")
      const parts = header.name.split("/");
      // Remove the first component (the directory name itself)
      parts.shift();
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

/**
 * Parse Bedrock LevelDB to extract chunk positions and biomes.
 * Uses leveldb-zlib for Bedrock's zlib-compressed LevelDB format.
 */
async function parseChunks(dbDir: string): Promise<ChunkInfo[]> {
  const { default: LevelDB } = await import("leveldb-zlib");

  const db = new LevelDB(dbDir, { createIfMissing: false });
  await db.open();

  const chunks = new Map<string, ChunkInfo>();

  try {
    // Iterate all keys looking for Data2D (tag 45) or Data3D (tag 43) records
    const iterator = db.getIterator({});

    for await (const [keyBuf, valueBuf] of iterator) {
      const key = Buffer.isBuffer(keyBuf) ? keyBuf : Buffer.from(keyBuf);
      const value = Buffer.isBuffer(valueBuf) ? valueBuf : Buffer.from(valueBuf);

      const parsed = parseChunkKey(key);
      if (!parsed) continue;

      // Only map the overworld (dimension 0)
      if (parsed.dimension !== 0) continue;

      const chunkKey = `${parsed.x},${parsed.z}`;

      if (parsed.tag === 45 && !chunks.has(chunkKey)) {
        // Data2D: 512 bytes height + 256 bytes biome
        if (value.length >= 768) {
          const centerBiome = value[512 + 8 * 16 + 8]; // center column biome
          chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome: centerBiome });
        }
      } else if (parsed.tag === 43 && !chunks.has(chunkKey)) {
        // Data3D: try to extract biome from palette-based format
        const biome = parseData3DBiome(value);
        if (biome !== null) {
          chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome });
        }
      } else if (parsed.tag === 44 && !chunks.has(chunkKey)) {
        // Version tag — chunk exists but no biome data yet, mark with default
        chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome: -1 });
      }
    }
  } finally {
    await db.close();
  }

  return Array.from(chunks.values());
}

/**
 * Parse a Bedrock LevelDB chunk key to extract coordinates, dimension, and tag.
 */
function parseChunkKey(key: Buffer): { x: number; z: number; dimension: number; tag: number } | null {
  if (key.length === 9 || key.length === 10) {
    // Overworld: [x:4][z:4][tag:1]
    return {
      x: key.readInt32LE(0),
      z: key.readInt32LE(4),
      dimension: 0,
      tag: key[8],
    };
  }
  if (key.length === 13 || key.length === 14) {
    // Other dimension: [x:4][z:4][dimension:4][tag:1]
    return {
      x: key.readInt32LE(0),
      z: key.readInt32LE(4),
      dimension: key.readInt32LE(8),
      tag: key[12],
    };
  }
  return null;
}

/**
 * Parse Data3D (tag 43) biome data. Returns the center surface biome or null.
 * Data3D format: 512 bytes height map + 3D biome palette sections.
 */
function parseData3DBiome(value: Buffer): number | null {
  if (value.length < 516) return null;

  try {
    // Skip height map (512 bytes)
    let offset = 512;

    // Each biome section has: palette type byte, then palette data
    // We want the surface section — read the first biome section
    if (offset >= value.length) return null;

    const bitsPerEntry = value[offset] >> 1;
    offset++;

    if (bitsPerEntry === 0) {
      // Single biome for the whole section — read the palette (one entry)
      if (offset + 4 <= value.length) {
        return value.readInt32LE(offset);
      }
      return null;
    }

    // Skip the bit array to get to the palette
    const blocksPerWord = Math.floor(32 / bitsPerEntry);
    const wordCount = Math.ceil(4096 / blocksPerWord);
    offset += wordCount * 4;

    // Read palette size
    if (offset + 4 > value.length) return null;
    const paletteSize = value.readInt32LE(offset);
    offset += 4;

    // Read first palette entry (most common biome in the section)
    if (paletteSize > 0 && offset + 4 <= value.length) {
      return value.readInt32LE(offset);
    }
  } catch {
    // Parsing failed, skip this chunk
  }

  return null;
}

/**
 * Render chunk data into a PNG image.
 */
function renderMap(chunks: ChunkInfo[], scale: number): Buffer {
  if (chunks.length === 0) {
    throw new Error("No chunks to render");
  }

  // Find bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const chunk of chunks) {
    if (chunk.x < minX) minX = chunk.x;
    if (chunk.x > maxX) maxX = chunk.x;
    if (chunk.z < minZ) minZ = chunk.z;
    if (chunk.z > maxZ) maxZ = chunk.z;
  }

  const width = (maxX - minX + 1) * scale;
  const height = (maxZ - minZ + 1) * scale;

  // Clamp to reasonable size
  const maxDim = 4096;
  if (width > maxDim || height > maxDim) {
    throw new Error(`Map too large (${width}x${height}). World is very large — try a smaller scale.`);
  }

  const png = new PNG({ width, height });

  // Fill with dark background (unexplored)
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 24;     // R
    png.data[i + 1] = 24; // G
    png.data[i + 2] = 24; // B
    png.data[i + 3] = 255; // A
  }

  // Draw chunks
  for (const chunk of chunks) {
    const color = BIOME_COLORS[chunk.biome] || DEFAULT_COLOR;
    const px = (chunk.x - minX) * scale;
    const pz = (chunk.z - minZ) * scale;

    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const idx = ((pz + dy) * width + (px + dx)) * 4;
        if (idx >= 0 && idx < png.data.length) {
          png.data[idx] = color[0];
          png.data[idx + 1] = color[1];
          png.data[idx + 2] = color[2];
          png.data[idx + 3] = 255;
        }
      }
    }
  }

  return PNG.sync.write(png);
}
