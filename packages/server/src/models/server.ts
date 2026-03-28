export interface BedrockServer {
  containerId: string;
  containerName: string;
  image: string;
  status: "running" | "stopped" | "paused";
  ports: Array<{
    hostPort: number;
    containerPort: number;
    protocol: string;
  }>;
  serverName?: string;
  levelName?: string;
  gameMode?: string;
  /** Host-side path to the /data mount, if available */
  dataMount?: string;
  /** Static IP address if using a custom network (e.g. macvlan) */
  ipAddress?: string;
}

export interface ServerDetail extends BedrockServer {
  installedBehaviorPacks: Array<{ pack_id: string; version: number[] }>;
  installedResourcePacks: Array<{ pack_id: string; version: number[] }>;
  playerCount?: number;
  maxPlayers?: number;
  players?: string[];
  operators?: Array<{ permission: string; xuid: string; name?: string }>;
}
