import Dockerode from "dockerode";
import { PassThrough } from "stream";
import { config } from "../config.js";
import type { BedrockServer, ServerDetail } from "../models/server.js";

let docker: Dockerode;

function getDocker(): Dockerode {
  if (!docker) {
    docker = new Dockerode({ socketPath: config.dockerSocket });
  }
  return docker;
}

export async function listBedrockServers(): Promise<BedrockServer[]> {
  const d = getDocker();
  const containers = await d.listContainers({ all: true });

  const bedrockContainers = containers.filter((c) =>
    config.bedrockImageFilter.some(
      (filter) =>
        c.Image.toLowerCase().includes(filter.toLowerCase()) ||
        c.Labels?.["addon-manager.type"] === "bedrock"
    )
  );

  return bedrockContainers.map((c) => ({
    containerId: c.Id.substring(0, 12),
    containerName: c.Names[0]?.replace(/^\//, "") || c.Id.substring(0, 12),
    image: c.Image,
    status: c.State === "running" ? "running" : c.State === "paused" ? "paused" : "stopped",
    ports: (c.Ports || []).map((p) => ({
      hostPort: p.PublicPort || 0,
      containerPort: p.PrivatePort,
      protocol: p.Type,
    })),
    dataMount: c.Mounts?.find((m) => m.Destination === "/data")?.Source,
  }));
}

export async function getServerDetail(containerId: string): Promise<ServerDetail | null> {
  const servers = await listBedrockServers();
  const server = servers.find(
    (s) => s.containerId === containerId || s.containerName === containerId
  );
  if (!server) return null;

  const detail: ServerDetail = {
    ...server,
    installedBehaviorPacks: [],
    installedResourcePacks: [],
  };

  if (server.status !== "running") return detail;

  try {
    const d = getDocker();
    const container = d.getContainer(server.containerId);

    // Read server.properties to get level-name and server-name
    const propsContent = await execInContainer(container, [
      "cat",
      "/data/server.properties",
    ]);
    if (propsContent) {
      const props = parseProperties(propsContent);
      detail.serverName = props["server-name"];
      detail.levelName = props["level-name"];
      detail.gameMode = props["gamemode"];
    }

    const levelName = detail.levelName || "Bedrock level";

    // Read world pack registration files
    const bpJson = await execInContainer(container, [
      "cat",
      `/data/worlds/${levelName}/world_behavior_packs.json`,
    ]);
    if (bpJson) {
      try {
        detail.installedBehaviorPacks = JSON.parse(bpJson);
      } catch { /* empty or invalid */ }
    }

    const rpJson = await execInContainer(container, [
      "cat",
      `/data/worlds/${levelName}/world_resource_packs.json`,
    ]);
    if (rpJson) {
      try {
        detail.installedResourcePacks = JSON.parse(rpJson);
      } catch { /* empty or invalid */ }
    }
  } catch (err) {
    console.error(`Failed to get details for ${containerId}:`, err);
  }

  return detail;
}

export async function execInContainer(
  container: Dockerode.Container,
  cmd: string[]
): Promise<string | null> {
  try {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false, Tty: false });

    return new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      // Use Dockerode's demuxStream to properly separate stdout/stderr
      // Docker multiplexed stream protocol uses 8-byte headers per frame
      const d = getDocker();
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      stdoutStream.on("data", (chunk: Buffer) => stdout.push(chunk));
      stderrStream.on("data", (chunk: Buffer) => stderr.push(chunk));

      d.modem.demuxStream(stream, stdoutStream, stderrStream);

      stream.on("end", () => {
        const output = Buffer.concat(stdout).toString("utf-8").trim();
        resolve(output || null);
      });
      stream.on("error", () => resolve(null));
    });
  } catch {
    return null;
  }
}

function parseProperties(content: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      props[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
    }
  }
  return props;
}

export interface CreateServerOptions {
  name: string;
  serverName: string;
  gameMode: "survival" | "creative" | "adventure";
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  maxPlayers: number;
  allowCheats: boolean;
}

export async function createServer(opts: CreateServerOptions): Promise<BedrockServer> {
  const { getSettings, allocateIp, allocatePort } = await import("./settings.js");
  const settings = getSettings();
  const d = getDocker();
  const image = "itzg/minecraft-bedrock-server";

  // Pull the image if not already available
  await new Promise<void>((resolve, reject) => {
    d.pull(image, (err: any, stream: any) => {
      if (err) return reject(err);
      d.modem.followProgress(stream, (err: any) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });

  const containerName = opts.name.replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase();

  // Determine data bind mount
  let dataBind: string;
  if (settings.dataBasePath) {
    dataBind = `${settings.dataBasePath}/${containerName}:/data`;
  } else {
    dataBind = `${containerName}-data:/data`;
  }

  // Build host config based on network mode
  const hostConfig: any = {
    Binds: [dataBind],
    RestartPolicy: { Name: "unless-stopped" },
  };

  const networkingConfig: any = {};
  let assignedPort = 19132;
  let assignedIp: string | undefined;

  if (settings.networkMode === "host" && settings.hostNetwork) {
    // Host network mode: auto-allocate a static IP
    const usedIps = await getUsedIpsOnNetwork(settings.hostNetwork);
    const ip = await allocateIp(usedIps);
    if (!ip) {
      throw new Error(
        "No available IP addresses in the configured range. Check Settings or free up an IP."
      );
    }
    assignedIp = ip;

    networkingConfig.EndpointsConfig = {
      [settings.hostNetwork]: {
        IPAMConfig: { IPv4Address: ip },
      },
    };
  } else {
    // Bridge mode: auto-allocate a port from the pool
    const usedPorts = await getUsedPortsFromContainers();
    const port = await allocatePort(usedPorts);
    if (!port) {
      throw new Error(
        "No available ports in the configured range. Check Settings or free up a port."
      );
    }
    assignedPort = port;

    hostConfig.PortBindings = {
      "19132/udp": [{ HostPort: port.toString() }],
    };
  }

  const containerConfig: any = {
    Image: image,
    name: containerName,
    Env: [
      "EULA=TRUE",
      `SERVER_NAME=${opts.serverName}`,
      `GAMEMODE=${opts.gameMode}`,
      `DIFFICULTY=${opts.difficulty}`,
      `MAX_PLAYERS=${opts.maxPlayers}`,
      `ALLOW_CHEATS=${opts.allowCheats}`,
    ],
    ExposedPorts: {
      "19132/udp": {},
    },
    HostConfig: hostConfig,
    NetworkingConfig: networkingConfig,
    Labels: {
      "addon-manager.type": "bedrock",
      "addon-manager.managed": "true",
    },
    OpenStdin: true,
    Tty: true,
  };

  const container = await d.createContainer(containerConfig);
  await container.start();

  const info = await container.inspect();

  return {
    containerId: info.Id.substring(0, 12),
    containerName: containerName,
    image,
    status: "running",
    ports: [{ hostPort: assignedPort, containerPort: 19132, protocol: "udp" }],
    serverName: opts.serverName,
  };
}

/** Get IPs currently in use on a Docker network */
async function getUsedIpsOnNetwork(networkName: string): Promise<string[]> {
  const d = getDocker();
  try {
    const network = d.getNetwork(networkName);
    const info = await network.inspect();
    const containers = info.Containers || {};
    return Object.values(containers).map((c: any) =>
      (c.IPv4Address || "").replace(/\/\d+$/, "")
    );
  } catch {
    return [];
  }
}

/** Get ports currently mapped by existing Bedrock containers */
async function getUsedPortsFromContainers(): Promise<number[]> {
  const servers = await listBedrockServers();
  const ports: number[] = [];
  for (const s of servers) {
    for (const p of s.ports) {
      if (p.hostPort > 0) ports.push(p.hostPort);
    }
  }
  return ports;
}

export async function stopServer(containerId: string): Promise<void> {
  const d = getDocker();
  const container = d.getContainer(containerId);
  await container.stop();
}

export async function startServer(containerId: string): Promise<void> {
  const d = getDocker();
  const container = d.getContainer(containerId);
  await container.start();
}

export async function restartServer(containerId: string): Promise<void> {
  const d = getDocker();
  const container = d.getContainer(containerId);
  await container.restart();
}

export async function deleteServer(containerId: string): Promise<void> {
  const d = getDocker();
  const container = d.getContainer(containerId);
  try {
    await container.stop();
  } catch { /* may already be stopped */ }
  await container.remove();
}

export function getDockerInstance(): Dockerode {
  return getDocker();
}
