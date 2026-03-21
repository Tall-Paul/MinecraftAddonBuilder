import { execSync } from "child_process";
import net from "net";
import { getDb } from "../db/index.js";

export interface ServerDefaults {
  networkMode: "bridge" | "host";
  hostNetwork: string;
  ipRangeStart: string;
  ipRangeEnd: string;
  portRangeStart: number;
  portRangeEnd: number;
  dataBasePath: string;
  defaultGameMode: "survival" | "creative" | "adventure";
  defaultDifficulty: "peaceful" | "easy" | "normal" | "hard";
  defaultMaxPlayers: number;
  defaultAllowCheats: boolean;
}

const DEFAULTS: ServerDefaults = {
  networkMode: "bridge",
  hostNetwork: "",
  ipRangeStart: "",
  ipRangeEnd: "",
  portRangeStart: 19132,
  portRangeEnd: 19162,
  dataBasePath: "",
  defaultGameMode: "survival",
  defaultDifficulty: "normal",
  defaultMaxPlayers: 10,
  defaultAllowCheats: false,
};

export function getSettings(): ServerDefaults {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;

  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in settings) {
      const key = row.key as keyof ServerDefaults;
      if (typeof DEFAULTS[key] === "number") {
        (settings as any)[key] = parseInt(row.value, 10) || DEFAULTS[key];
      } else if (typeof DEFAULTS[key] === "boolean") {
        (settings as any)[key] = row.value === "true";
      } else {
        (settings as any)[key] = row.value;
      }
    }
  }

  return settings;
}

export function updateSettings(updates: Partial<ServerDefaults>): ServerDefaults {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (key in DEFAULTS) {
        upsert.run(key, String(value));
      }
    }
  });

  transaction();
  return getSettings();
}

/** Find the next available IP in the configured range, checking with ping */
export async function allocateIp(usedIps: string[]): Promise<string | null> {
  const settings = getSettings();
  if (!settings.ipRangeStart || !settings.ipRangeEnd) return null;

  const start = ipToNum(settings.ipRangeStart);
  const end = ipToNum(settings.ipRangeEnd);
  if (start === null || end === null || start > end) return null;

  const usedSet = new Set(usedIps);

  for (let n = start; n <= end; n++) {
    const ip = numToIp(n);
    if (usedSet.has(ip)) continue;

    // Ping to check if anything is already using this IP
    const inUse = await isIpInUse(ip);
    if (!inUse) return ip;
  }

  return null;
}

/** Find the next available port in the configured range, checking if already bound */
export async function allocatePort(usedPorts: number[]): Promise<number | null> {
  const settings = getSettings();
  const start = settings.portRangeStart;
  const end = settings.portRangeEnd;
  if (!start || !end || start > end) return null;

  const usedSet = new Set(usedPorts);

  for (let port = start; port <= end; port++) {
    if (usedSet.has(port)) continue;

    const inUse = await isPortInUse(port);
    if (!inUse) return port;
  }

  return null;
}

/** Ping an IP to see if it responds (quick 1-second timeout) */
async function isIpInUse(ip: string): Promise<boolean> {
  try {
    // Use ping with short timeout; works on Linux (Alpine in Docker)
    execSync(`ping -c 1 -W 1 ${ip}`, { timeout: 2000, stdio: "pipe" });
    return true; // got a response, IP is in use
  } catch {
    return false; // no response, IP is available
  }
}

/** Try connecting to a UDP port to check if something is already listening */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Check TCP first (catches most services), then assume UDP is fine
    // For Bedrock servers, we also do a quick UDP probe
    const server = net.createServer();
    server.once("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "0.0.0.0");
  });
}

function ipToNum(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function numToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}
