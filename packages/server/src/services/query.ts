import dgram from "dgram";
import { execInContainer } from "./docker.js";
import Dockerode from "dockerode";

export interface ServerStatus {
  online: boolean;
  playerCount: number;
  maxPlayers: number;
  players: string[];
}

/**
 * Query a Bedrock server's status via the RakNet Unconnected Ping protocol.
 * Returns player count and max players. Works on any reachable Bedrock server.
 */
export function queryBedrockServer(host: string, port: number, timeoutMs = 3000): Promise<{ online: boolean; playerCount: number; maxPlayers: number }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      resolve({ online: false, playerCount: 0, maxPlayers: 0 });
    }, timeoutMs);

    socket.on("message", (msg) => {
      clearTimeout(timer);
      try {
        // RakNet Unconnected Pong response
        // Format: ID_UNCONNECTED_PONG (0x1c) + 8 bytes time + 8 bytes server GUID + 16 bytes magic + 2 bytes string length + string
        const headerLen = 1 + 8 + 8 + 16; // 33 bytes before string length
        const strLen = msg.readUInt16BE(headerLen);
        const payload = msg.subarray(headerLen + 2, headerLen + 2 + strLen).toString("utf-8");
        // Payload format: "MCPE;server name;protocol;version;players;max players;..."
        const parts = payload.split(";");
        console.log(`query: parsed ${parts.length} fields, players=${parts[4]}, max=${parts[5]}`);
        const playerCount = parseInt(parts[4], 10) || 0;
        const maxPlayers = parseInt(parts[5], 10) || 0;
        resolve({ online: true, playerCount, maxPlayers });
      } catch (err) {
        console.log(`query: failed to parse pong response (${msg.length} bytes):`, err);
        resolve({ online: true, playerCount: 0, maxPlayers: 0 });
      }
      socket.close();
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.close();
      resolve({ online: false, playerCount: 0, maxPlayers: 0 });
    });

    // RakNet Unconnected Ping packet
    const buf = Buffer.alloc(33);
    buf[0] = 0x01; // ID_UNCONNECTED_PING
    // 8 bytes timestamp
    const now = BigInt(Date.now());
    buf.writeBigInt64BE(now, 1);
    // 16 bytes offline message data ID (magic)
    const magic = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");
    magic.copy(buf, 9);
    // 8 bytes client GUID
    buf.writeBigInt64BE(BigInt(2), 25);

    socket.send(buf, port, host);
  });
}

/**
 * Get the list of online player names using the server console `list` command.
 * Tries the itzg `send-command` helper first, falls back to other methods.
 */
export async function getPlayerNames(container: Dockerode.Container): Promise<string[]> {
  const output = await sendServerCommand(container, "list");
  if (!output) return [];

  // Parse "There are X/Y players online:\nPlayer1, Player2"
  // or "There are X/Y players online:" with no names
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/There are (\d+)\/(\d+) players online/i);
    if (match) {
      const count = parseInt(match[1], 10);
      if (count === 0) return [];

      // Player names are usually on the next line or after the colon
      const afterColon = line.split(":")[1]?.trim();
      if (afterColon) {
        return afterColon.split(",").map((s) => s.trim()).filter(Boolean);
      }

      // Check the next line
      const idx = lines.indexOf(line);
      if (idx + 1 < lines.length) {
        const nextLine = lines[idx + 1].trim();
        if (nextLine) {
          return nextLine.split(",").map((s) => s.trim()).filter(Boolean);
        }
      }
    }
  }

  return [];
}

/**
 * Send a console command to a Bedrock server container.
 * Tries itzg's send-command helper first, falls back to Docker attach.
 */
export async function sendCommand(container: Dockerode.Container, command: string): Promise<string | null> {
  return sendServerCommand(container, command);
}

/**
 * Universal command sender: tries send-command (itzg), falls back to Docker attach.
 */
async function sendServerCommand(container: Dockerode.Container, command: string): Promise<string | null> {
  // Try itzg's send-command first
  const output = await execInContainer(container, ["send-command", command]);
  if (output && !output.includes("executable file not found")) {
    return output;
  }
  // Fallback to Docker attach
  return sendViaStdin(container, command);
}

/**
 * Op a player on a Bedrock server.
 */
export async function opPlayer(container: Dockerode.Container, playerName: string): Promise<string | null> {
  return sendCommand(container, `op ${playerName}`);
}

/**
 * Deop a player on a Bedrock server.
 */
export async function deopPlayer(container: Dockerode.Container, playerName: string): Promise<string | null> {
  return sendCommand(container, `deop ${playerName}`);
}

/**
 * Read the permissions.json file from the server to get current operators.
 * Returns list of player XUIDs and permissions, or reads from the op command output.
 */
export async function getOperators(container: Dockerode.Container, basePath: string): Promise<Array<{ permission: string; xuid: string; name?: string }>> {
  const content = await execInContainer(container, ["cat", `${basePath}/permissions.json`]);
  if (!content) return [];

  try {
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Get player count and max players via the console `list` command.
 * More reliable than UDP query when running from another container.
 */
export async function getPlayerCount(container: Dockerode.Container): Promise<{ playerCount: number; maxPlayers: number }> {
  try {
    const output = await sendServerCommand(container, "list");
    if (!output) return { playerCount: 0, maxPlayers: 0 };

    for (const line of output.split("\n")) {
      const match = line.match(/There are (\d+)\/(\d+) players online/i);
      if (match) {
        return {
          playerCount: parseInt(match[1], 10),
          maxPlayers: parseInt(match[2], 10),
        };
      }
    }
    return { playerCount: 0, maxPlayers: 0 };
  } catch (err: any) {
    console.log(`getPlayerCount: error: ${err.message}`);
    return { playerCount: 0, maxPlayers: 0 };
  }
}

/**
 * Send a command to the Bedrock server via Docker attach (stdin/stdout).
 * Attaches to the container, writes the command, reads output, then detaches.
 */
async function sendViaStdin(container: Dockerode.Container, command: string): Promise<string | null> {
  // Check if container uses TTY (affects stream format)
  let isTty = true;
  try {
    const info = await container.inspect();
    isTty = info.Config?.Tty ?? true;
  } catch { /* assume TTY */ }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);

    container.attach(
      { stream: true, stdin: true, stdout: true, stderr: true, hijack: true },
      (err, stream) => {
        if (err || !stream) {
          clearTimeout(timeout);
          return resolve(null);
        }

        const chunks: Buffer[] = [];
        let collecting = false;

        stream.on("data", (chunk: Buffer) => {
          if (collecting) {
            chunks.push(chunk);
          }
        });

        // Start collecting after we send the command
        collecting = true;
        stream.write(command + "\n");

        // Give the server time to respond, then collect
        setTimeout(() => {
          clearTimeout(timeout);
          try { stream.end(); } catch { /* ignore */ }

          let raw = Buffer.concat(chunks);

          // If not TTY, Docker multiplexes the stream with 8-byte frame headers
          if (!isTty) {
            raw = demuxDockerStream(raw);
          }

          // Strip ANSI escape sequences and control characters
          const output = raw.toString("utf-8")
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") // ANSI escape sequences
            .replace(/\r/g, "")                      // carriage returns
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // other control chars

          console.log(`sendViaStdin: cleaned output = ${JSON.stringify(output.substring(0, 300))}`);
          resolve(output || null);
        }, 1500);
      },
    );
  });
}

/** Demultiplex Docker attach stream (strip 8-byte frame headers). */
function demuxDockerStream(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (offset + 8 + size > buf.length) break;
    parts.push(buf.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return parts.length > 0 ? Buffer.concat(parts) : buf;
}

/**
 * Get full server status: player count + player names.
 */
export async function getServerStatus(
  container: Dockerode.Container,
  host: string,
  port: number
): Promise<ServerStatus> {
  // Get player count and names via console command (more reliable than UDP from another container)
  const counts = await getPlayerCount(container);
  let players: string[] = [];
  if (counts.playerCount > 0) {
    players = await getPlayerNames(container);
  }

  return {
    online: true,
    playerCount: counts.playerCount,
    maxPlayers: counts.maxPlayers,
    players,
  };
}
