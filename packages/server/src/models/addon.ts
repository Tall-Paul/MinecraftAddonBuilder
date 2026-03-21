export interface AddonSearchResult {
  id: string;
  source: "curseforge" | "mcpedl" | "modrinth";
  name: string;
  summary: string;
  author: string;
  thumbnailUrl: string;
  downloadCount?: number;
  pageUrl: string;
  /** CurseForge-specific fields */
  curseforgeId?: number;
  curseforgeFileId?: number;
  /** Modrinth-specific fields */
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

export interface PackManifest {
  formatVersion: number;
  header: {
    name: string;
    description: string;
    uuid: string;
    version: [number, number, number];
    min_engine_version?: [number, number, number];
  };
  modules: Array<{
    type: "data" | "resources" | "script";
    uuid: string;
    version: [number, number, number];
  }>;
  dependencies?: Array<{
    uuid: string;
    version: [number, number, number];
  }>;
}

export interface ExtractedPack {
  name: string;
  uuid: string;
  version: [number, number, number];
  type: "behavior" | "resource";
  manifest: PackManifest;
  /** Path to the extracted pack directory in cache */
  extractedPath: string;
}

export interface InstalledAddon {
  id: number;
  containerId: string;
  containerName: string;
  addonSource: string;
  addonSourceId: string;
  addonName: string;
  packs: string; // JSON array of {uuid, version, type}
  installedAt: string;
}
