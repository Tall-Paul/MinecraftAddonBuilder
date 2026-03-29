export interface AddonSearchResult {
  id: string;
  source: "curseforge" | "mcpedl" | "modrinth";
  name: string;
  summary: string;
  author: string;
  thumbnailUrl: string;
  downloadCount?: number;
  pageUrl: string;
  curseforgeId?: number;
  curseforgeFileId?: number;
  modrinthId?: string;
  modrinthVersionId?: string;
}

export interface AddonDetail extends AddonSearchResult {
  description: string;
  screenshots: string[];
  downloadUrl?: string;
  canAutoDownload: boolean;
  categories?: string[];
  dateCreated?: string;
  dateModified?: string;
  latestFileName?: string;
}

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
  dataMount?: string;
  ipAddress?: string;
  playerCount?: number;
  maxPlayers?: number;
}

export interface ServerDetail extends BedrockServer {
  installedBehaviorPacks: Array<{ pack_id: string; version: number[] }>;
  installedResourcePacks: Array<{ pack_id: string; version: number[] }>;
  players?: string[];
  operators?: Array<{ permission: string; xuid: string; name?: string }>;
}

export interface Installation {
  id: number;
  container_id: string;
  container_name: string;
  addon_source: string;
  addon_source_id: string;
  addon_name: string;
  packs: string; // JSON
  installed_at: string;
}

export interface InstallResult {
  success: boolean;
  message: string;
  installedPacks: Array<{ name: string; uuid: string; type: string }>;
  errors: string[];
}

export interface AppStatus {
  status: string;
  dockerConnected: boolean;
  curseforgeConfigured: boolean;
  gitCommit: string;
  buildTime: string | null;
}

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

export interface Backup {
  id: number;
  container_id: string;
  container_name: string;
  server_name: string | null;
  file_path: string;
  file_size: number;
  google_drive_id: string | null;
  created_at: string;
}

export interface BackupSchedule {
  enabled: boolean;
  time: string;
  containers: string[];
}

export interface GoogleDriveConfig {
  configured: boolean;
  folderId: string;
  projectId: string | null;
  serviceAccountEmail: string | null;
  lastError: string | null;
}
