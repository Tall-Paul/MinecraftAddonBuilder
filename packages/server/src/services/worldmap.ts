import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import * as fzstd from "fzstd";
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
  8: [255, 0, 0],         // Nether
  9: [128, 128, 255],     // The End
  10: [144, 144, 160],    // Frozen Ocean
  11: [160, 160, 255],    // Frozen River
  12: [255, 255, 255],    // Ice Plains
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
  29: [64, 81, 26],       // Dark Forest
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
  40: [0, 0, 172],        // Warm Ocean
  41: [32, 32, 112],      // Lukewarm Ocean
  42: [64, 64, 144],      // Cold Ocean
  43: [0, 0, 80],         // Deep Warm Ocean
  44: [0, 0, 64],         // Deep Lukewarm Ocean
  45: [32, 32, 56],       // Deep Cold Ocean
  46: [32, 32, 112],      // Deep Frozen Ocean
  127: [0, 0, 0],         // The Void
  129: [176, 220, 128],   // Sunflower Plains
  130: [230, 168, 60],    // Desert M
  131: [120, 120, 120],   // Extreme Hills M
  132: [37, 130, 48],     // Flower Forest
  133: [51, 142, 129],    // Taiga M
  134: [47, 255, 218],    // Swampland M
  140: [180, 220, 220],   // Ice Plains Spikes
  149: [109, 159, 35],    // Jungle M
  155: [75, 145, 95],     // Birch Forest M
  156: [57, 120, 75],     // Birch Forest Hills M
  157: [96, 121, 66],     // Dark Forest M
  160: [129, 142, 96],    // Mega Spruce Taiga
  161: [109, 119, 102],   // Mega Spruce Taiga Hills
  162: [120, 152, 120],   // Extreme Hills+ M
  163: [229, 218, 135],   // Savanna M
  164: [207, 197, 140],   // Savanna Plateau M
  165: [247, 109, 61],    // Mesa Bryce
  166: [216, 191, 141],   // Mesa Plateau F M
  167: [242, 180, 141],   // Mesa Plateau M
  168: [255, 167, 189],   // Cherry Grove
  169: [52, 105, 32],     // Mangrove Swamp
  190: [17, 20, 41],      // Deep Dark
};

const DEFAULT_COLOR: [number, number, number] = [128, 128, 128];
const EXPLORED_COLOR: [number, number, number] = [100, 100, 100]; // Chunk exists but no biome data

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

  const tempDir = path.join(os.tmpdir(), `mcmap-${containerId}-${Date.now()}`);

  try {
    console.log(`worldmap: extracting LevelDB from ${dbPath}`);
    await extractFromContainer(container, dbPath, tempDir);

    console.log(`worldmap: parsing chunks from LDB files`);
    const chunks = await parseLDBFiles(tempDir);
    console.log(`worldmap: found ${chunks.length} chunks`);

    if (chunks.length === 0) {
      throw new Error("No chunks found in world data");
    }

    console.log(`worldmap: rendering PNG`);
    return renderMap(chunks, scale);
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

/**
 * Parse LDB/SST table files directly to extract chunk coordinates and biome data.
 *
 * LevelDB table file format:
 * - Data blocks (compressed with zlib for Bedrock)
 * - Meta index block
 * - Index block (maps keys to data block offsets)
 * - Footer (48 bytes at end of file)
 *
 * Footer format (last 48 bytes):
 * - metaindex_handle (varint64 offset + varint64 size)
 * - index_handle (varint64 offset + varint64 size)
 * - padding to 40 bytes
 * - magic number (8 bytes: 0x57fb808b24753568)
 */
async function parseLDBFiles(dbDir: string): Promise<ChunkInfo[]> {
  const chunks = new Map<string, ChunkInfo>();

  const allFiles = fs.readdirSync(dbDir);
  console.log(`worldmap: db directory contains ${allFiles.length} files: ${allFiles.slice(0, 20).join(", ")}${allFiles.length > 20 ? "..." : ""}`);

  const files = allFiles.filter(
    (f) => f.endsWith(".ldb") || f.endsWith(".sst")
  );
  console.log(`worldmap: found ${files.length} table files (.ldb/.sst)`);

  for (const file of files) {
    try {
      const filePath = path.join(dbDir, file);
      const data = fs.readFileSync(filePath);
      const before = chunks.size;
      parseTableFile(data, chunks);
      if (chunks.size > before) {
        console.log(`worldmap: ${file} (${data.length} bytes) yielded ${chunks.size - before} new chunks`);
      }
    } catch (err) {
      console.warn(`worldmap: skipping ${file}: ${err}`);
    }
  }

  // Also check the log file for recent writes not yet in table files
  try {
    const logFile = path.join(dbDir, "CURRENT");
    if (fs.existsSync(logFile)) {
      const currentLog = fs.readFileSync(logFile, "utf-8").trim();
      console.log(`worldmap: CURRENT points to "${currentLog}"`);
      const walPath = path.join(dbDir, currentLog);
      if (fs.existsSync(walPath)) {
        const walData = fs.readFileSync(walPath);
        console.log(`worldmap: WAL file ${currentLog} is ${walData.length} bytes`);
        const before = chunks.size;
        parseLogFile(walData, chunks);
        console.log(`worldmap: WAL yielded ${chunks.size - before} new chunks`);
      }
    }
  } catch (err) {
    console.warn(`worldmap: WAL parsing error: ${err}`);
    // WAL parsing is best-effort
  }

  return Array.from(chunks.values());
}

/**
 * Parse a LevelDB table (.ldb/.sst) file.
 */
function parseTableFile(data: Buffer, chunks: Map<string, ChunkInfo>): void {
  if (data.length < 48) return;

  // Read footer (last 48 bytes)
  const footerStart = data.length - 48;

  // Verify magic number — standard LevelDB or Bedrock's variant
  const magic = data.readBigUInt64LE(footerStart + 40);
  const LEVELDB_MAGIC = 0x683575248b80fb57n;  // standard
  const BEDROCK_MAGIC = 0xdb4775248b80fb57n;   // Mojang/Bedrock variant
  if (magic !== LEVELDB_MAGIC && magic !== BEDROCK_MAGIC) {
    console.log(`worldmap: file magic mismatch: got 0x${magic.toString(16)}`);
    return;
  }

  // Read index block handle from footer
  let pos = footerStart;
  const metaHandle = readBlockHandle(data, pos);
  pos = metaHandle.newPos;
  const indexHandle = readBlockHandle(data, pos);

  console.log(`worldmap: file ${data.length} bytes, footer at ${footerStart}, index block: offset=${indexHandle.offset} size=${indexHandle.size}`);

  if (indexHandle.offset + indexHandle.size > data.length) {
    console.log(`worldmap: index block extends past file end`);
    return;
  }

  // Check compression type byte
  if (indexHandle.offset + indexHandle.size < data.length) {
    console.log(`worldmap: index block compression type byte: ${data[indexHandle.offset + indexHandle.size]}`);
  }

  // Read and decompress the index block
  const indexBlock = readBlock(data, indexHandle.offset, indexHandle.size);
  if (!indexBlock) {
    // Try reading as raw uncompressed (Bedrock may store index blocks uncompressed differently)
    console.log(`worldmap: readBlock failed, first bytes at offset: ${data.subarray(indexHandle.offset, indexHandle.offset + 16).toString("hex")}`);
    return;
  }

  // Parse index block to find data block locations
  const dataBlockHandles = parseIndexBlock(indexBlock);
  console.log(`worldmap: index block has ${dataBlockHandles.length} data block references`);

  let blocksRead = 0;
  let blocksFailed = 0;

  // Read each data block and extract chunk keys
  for (const handle of dataBlockHandles) {
    try {
      const block = readBlock(data, handle.offset, handle.size);
      if (block) {
        blocksRead++;
        parseDataBlock(block, chunks);
      } else {
        blocksFailed++;
      }
    } catch {
      blocksFailed++;
    }
  }

  if (blocksFailed > 0 || blocksRead > 0) {
    console.log(`worldmap: read ${blocksRead} data blocks, ${blocksFailed} failed`);
  }
}

interface BlockHandle {
  offset: number;
  size: number;
  newPos: number;
}

function readBlockHandle(data: Buffer, pos: number): BlockHandle {
  const offset = readVarint(data, pos);
  const size = readVarint(data, offset.newPos);
  return { offset: Number(offset.value), size: Number(size.value), newPos: size.newPos };
}

function readVarint(data: Buffer, pos: number): { value: bigint; newPos: number } {
  let result = 0n;
  let shift = 0n;
  let byte: number;
  let p = pos;

  do {
    if (p >= data.length) return { value: result, newPos: p };
    byte = data[p++];
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
  } while (byte & 0x80);

  return { value: result, newPos: p };
}

/**
 * Read and decompress a data block from the table file.
 * Block format: [data][type:1byte][crc:4bytes]
 * type: 0=uncompressed, 1=snappy, 2=zlib, 4=zstd
 */
function readBlock(data: Buffer, offset: number, size: number): Buffer | null {
  if (offset + size + 5 > data.length) {
    // Bedrock may omit the 4-byte CRC, try with just 1 byte for compression type
    if (offset + size + 1 > data.length) return null;
  }

  const blockData = data.subarray(offset, offset + size);
  const compressionType = data[offset + size];

  if (compressionType === 0) {
    return Buffer.from(blockData);
  } else if (compressionType === 2) {
    // Zlib
    try {
      return zlib.inflateRawSync(blockData);
    } catch {
      try {
        return zlib.unzipSync(blockData);
      } catch {
        return null;
      }
    }
  } else if (compressionType === 4) {
    // Zstd (newer Bedrock versions)
    try {
      const decompressed = fzstd.decompress(new Uint8Array(blockData));
      return Buffer.from(decompressed);
    } catch {
      return null;
    }
  } else if (compressionType === 1) {
    // Snappy
    return null;
  }

  return null;
}

/**
 * Parse an index block to get data block handles.
 */
function parseIndexBlock(block: Buffer): BlockHandle[] {
  const handles: BlockHandle[] = [];
  const entries = parseBlockEntries(block);

  for (const entry of entries) {
    if (entry.value.length >= 2) {
      const handle = readBlockHandle(entry.value, 0);
      handles.push(handle);
    }
  }

  return handles;
}

interface BlockEntry {
  key: Buffer;
  value: Buffer;
}

/**
 * Parse entries from a LevelDB block.
 * Block format: entries... + [restart_offsets:4bytes each] + [num_restarts:4bytes]
 */
function parseBlockEntries(block: Buffer): BlockEntry[] {
  if (block.length < 4) return [];

  const numRestarts = block.readUInt32LE(block.length - 4);
  const restartArrayStart = block.length - 4 - numRestarts * 4;
  if (restartArrayStart < 0) return [];

  const entries: BlockEntry[] = [];
  let pos = 0;
  let prevKey = Buffer.alloc(0);

  while (pos < restartArrayStart) {
    if (pos + 3 > restartArrayStart) break;

    // Each entry: shared_bytes(varint) + unshared_bytes(varint) + value_length(varint) + key_delta + value
    const shared = readVarint(block, pos);
    pos = shared.newPos;
    const unshared = readVarint(block, pos);
    pos = unshared.newPos;
    const valueLen = readVarint(block, pos);
    pos = valueLen.newPos;

    const sharedN = Number(shared.value);
    const unsharedN = Number(unshared.value);
    const valueLenN = Number(valueLen.value);

    if (pos + unsharedN + valueLenN > restartArrayStart) break;

    const keyDelta = block.subarray(pos, pos + unsharedN);
    pos += unsharedN;
    const value = Buffer.from(block.subarray(pos, pos + valueLenN));
    pos += valueLenN;

    // Reconstruct full key
    const key = Buffer.concat([prevKey.subarray(0, sharedN), keyDelta]);
    prevKey = key;

    entries.push({ key, value });
  }

  return entries;
}

/**
 * Parse a data block and extract chunk info from entries.
 */
function parseDataBlock(block: Buffer, chunks: Map<string, ChunkInfo>): void {
  const entries = parseBlockEntries(block);

  for (const entry of entries) {
    // Strip the 8-byte internal key suffix (sequence number + type) that LevelDB appends
    const userKey = entry.key.length > 8 ? entry.key.subarray(0, entry.key.length - 8) : entry.key;
    const parsed = parseChunkKey(userKey);
    if (!parsed || parsed.dimension !== 0) continue;

    const chunkKey = `${parsed.x},${parsed.z}`;

    if (parsed.tag === 45 && !chunks.has(chunkKey)) {
      // Data2D: 512 bytes height + 256 bytes biome
      if (entry.value.length >= 768) {
        const centerBiome = entry.value[512 + 8 * 16 + 8];
        chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome: centerBiome });
      }
    } else if (parsed.tag === 43 && !chunks.has(chunkKey)) {
      // Data3D
      const biome = parseData3DBiome(entry.value);
      if (biome !== null) {
        chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome });
      }
    } else if ((parsed.tag === 44 || parsed.tag === 118) && !chunks.has(chunkKey)) {
      // Version tag — chunk exists
      chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome: -1 });
    }
  }
}

/**
 * Parse a WAL/log file for recent entries.
 * Log format: blocks of 32KB, each with header: checksum(4) + length(2) + type(1) + data
 */
function parseLogFile(data: Buffer, chunks: Map<string, ChunkInfo>): void {
  const BLOCK_SIZE = 32768;
  const HEADER_SIZE = 7;
  let pos = 0;

  while (pos < data.length) {
    const blockStart = pos;
    const blockEnd = Math.min(blockStart + BLOCK_SIZE, data.length);

    let recordPos = blockStart;
    while (recordPos + HEADER_SIZE <= blockEnd) {
      const length = data.readUInt16LE(recordPos + 4);
      const type = data[recordPos + 6];

      if (type === 0 || length === 0) break;

      const recordData = data.subarray(recordPos + HEADER_SIZE, recordPos + HEADER_SIZE + length);

      if (recordData.length >= 12) {
        // Try to parse as a batch of put operations
        parseLogRecord(recordData, chunks);
      }

      recordPos += HEADER_SIZE + length;
    }

    pos = blockEnd;
  }
}

function parseLogRecord(data: Buffer, chunks: Map<string, ChunkInfo>): void {
  // WriteBatch format: sequence(8) + count(4) + entries...
  // Each entry: type(1) + key_len(varint) + key + value_len(varint) + value
  if (data.length < 12) return;

  let pos = 12; // skip sequence + count

  while (pos < data.length) {
    if (pos >= data.length) break;
    const type = data[pos++];

    if (type === 1) {
      // Put
      const keyLen = readVarint(data, pos);
      pos = keyLen.newPos;
      const kLen = Number(keyLen.value);
      if (pos + kLen > data.length) break;
      const key = data.subarray(pos, pos + kLen);
      pos += kLen;

      const valLen = readVarint(data, pos);
      pos = valLen.newPos;
      const vLen = Number(valLen.value);
      if (pos + vLen > data.length) break;
      const value = data.subarray(pos, pos + vLen);
      pos += vLen;

      const parsed = parseChunkKey(key);
      if (parsed && parsed.dimension === 0) {
        const chunkKey = `${parsed.x},${parsed.z}`;
        if (parsed.tag === 45 && value.length >= 768) {
          const centerBiome = value[512 + 8 * 16 + 8];
          chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome: centerBiome });
        } else if (parsed.tag === 43) {
          const biome = parseData3DBiome(Buffer.from(value));
          if (biome !== null) {
            chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome });
          }
        } else if (parsed.tag === 44 || parsed.tag === 118) {
          if (!chunks.has(chunkKey)) {
            chunks.set(chunkKey, { x: parsed.x, z: parsed.z, biome: -1 });
          }
        }
      }
    } else if (type === 0) {
      // Delete — skip key
      const keyLen = readVarint(data, pos);
      pos = keyLen.newPos;
      pos += Number(keyLen.value);
    } else {
      break;
    }
  }
}

/**
 * Parse a Bedrock chunk key.
 */
function parseChunkKey(key: Buffer): { x: number; z: number; dimension: number; tag: number } | null {
  if (key.length === 9 || key.length === 10) {
    return {
      x: key.readInt32LE(0),
      z: key.readInt32LE(4),
      dimension: 0,
      tag: key[8],
    };
  }
  if (key.length === 13 || key.length === 14) {
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
 * Parse Data3D biome palette to get the surface biome.
 */
function parseData3DBiome(value: Buffer): number | null {
  if (value.length < 516) return null;

  try {
    let offset = 512; // skip height map

    if (offset >= value.length) return null;
    const bitsPerEntry = value[offset] >> 1;
    offset++;

    if (bitsPerEntry === 0) {
      if (offset + 4 <= value.length) {
        return value.readInt32LE(offset);
      }
      return null;
    }

    const blocksPerWord = Math.floor(32 / bitsPerEntry);
    const wordCount = Math.ceil(4096 / blocksPerWord);
    offset += wordCount * 4;

    if (offset + 4 > value.length) return null;
    const paletteSize = value.readInt32LE(offset);
    offset += 4;

    if (paletteSize > 0 && offset + 4 <= value.length) {
      return value.readInt32LE(offset);
    }
  } catch { /* skip */ }

  return null;
}

/**
 * Render chunk data into a PNG image.
 */
function renderMap(chunks: ChunkInfo[], scale: number): Buffer {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const chunk of chunks) {
    if (chunk.x < minX) minX = chunk.x;
    if (chunk.x > maxX) maxX = chunk.x;
    if (chunk.z < minZ) minZ = chunk.z;
    if (chunk.z > maxZ) maxZ = chunk.z;
  }

  const width = (maxX - minX + 1) * scale;
  const height = (maxZ - minZ + 1) * scale;

  const maxDim = 4096;
  if (width > maxDim || height > maxDim) {
    throw new Error(`Map too large (${width}x${height}). Try a smaller scale.`);
  }

  const png = new PNG({ width, height });

  // Dark background for unexplored areas
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 24;
    png.data[i + 1] = 24;
    png.data[i + 2] = 24;
    png.data[i + 3] = 255;
  }

  for (const chunk of chunks) {
    const color = chunk.biome === -1
      ? EXPLORED_COLOR
      : (BIOME_COLORS[chunk.biome] || DEFAULT_COLOR);
    const px = (chunk.x - minX) * scale;
    const pz = (chunk.z - minZ) * scale;

    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const idx = ((pz + dy) * width + (px + dx)) * 4;
        if (idx >= 0 && idx + 3 < png.data.length) {
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
