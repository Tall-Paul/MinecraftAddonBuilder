import type {
  AddonSearchResult,
  AddonDetail,
  BedrockServer,
  ServerDetail,
  Installation,
  InstallResult,
  AppStatus,
  ServerDefaults,
} from "../types/index.js";

const API_BASE = "/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

// Status
export async function getStatus(): Promise<AppStatus> {
  return apiFetch("/status");
}

// Servers
export async function getServers(): Promise<BedrockServer[]> {
  const data = await apiFetch<{ servers: BedrockServer[] }>("/servers");
  return data.servers;
}

export async function getServerDetail(
  id: string
): Promise<{ server: ServerDetail; installations: Installation[] }> {
  return apiFetch(`/servers/${id}`);
}

export interface CreateServerParams {
  name: string;
  serverName: string;
  gameMode: string;
  difficulty: string;
  maxPlayers: number;
  allowCheats: boolean;
}

export async function createServer(
  params: CreateServerParams
): Promise<{ server: BedrockServer }> {
  return apiFetch("/servers", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function startServer(id: string): Promise<void> {
  await apiFetch(`/servers/${id}/start`, { method: "POST" });
}

export async function stopServer(id: string): Promise<void> {
  await apiFetch(`/servers/${id}/stop`, { method: "POST" });
}

export async function restartServer(id: string): Promise<void> {
  await apiFetch(`/servers/${id}/restart`, { method: "POST" });
}

export async function deleteServerApi(id: string): Promise<void> {
  await apiFetch(`/servers/${id}`, { method: "DELETE" });
}

// Addons
export async function searchAddons(
  query: string,
  source: string = "all",
  page: number = 0
): Promise<{ results: AddonSearchResult[]; totalCount: number }> {
  return apiFetch(
    `/addons/search?q=${encodeURIComponent(query)}&source=${source}&page=${page}`
  );
}

export async function getAddonDetail(
  source: string,
  id: string
): Promise<AddonDetail> {
  return apiFetch(`/addons/${source}/${id}`);
}

// Install
export async function installFromSource(params: {
  containerId: string;
  source: string;
  sourceId: string;
  name: string;
  modId?: number;
  fileId?: number;
  modrinthId?: string;
  modrinthVersionId?: string;
}): Promise<InstallResult> {
  return apiFetch("/install/download", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function uploadAndInstall(
  containerId: string,
  file: File
): Promise<InstallResult> {
  const formData = new FormData();
  formData.append("addon", file);
  formData.append("containerId", containerId);

  const res = await fetch(`${API_BASE}/install/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function uninstallAddon(
  containerId: string,
  installationId: number
): Promise<void> {
  await apiFetch(`/install/${containerId}/${installationId}`, {
    method: "DELETE",
  });
}

// Settings
export async function getSettingsApi(): Promise<ServerDefaults> {
  return apiFetch("/settings");
}

export interface DockerNetwork {
  name: string;
  driver: string;
  scope: string;
  subnet: string;
}

export async function getDockerNetworks(): Promise<DockerNetwork[]> {
  return apiFetch("/settings/networks");
}

export async function updateSettingsApi(
  settings: Partial<ServerDefaults>
): Promise<ServerDefaults> {
  return apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
