import { config } from "../config.js";
import type { AddonSearchResult, AddonDetail } from "../models/addon.js";

const BASE_URL = "https://api.curseforge.com";
// Minecraft Bedrock is a separate game on CurseForge (not gameId 432 which is Java)
const BEDROCK_GAME_ID = 78022;
// CurseForge class ID for Bedrock addons
const BEDROCK_ADDONS_CLASS_ID = 4984;

async function cfFetch(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": config.curseforgeApiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CurseForge API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function initCurseForge(): Promise<void> {
  if (!config.curseforgeApiKey) {
    console.warn("No CurseForge API key configured — CurseForge search will be unavailable");
    return;
  }

  try {
    // Verify the API key works by hitting a simple endpoint
    await cfFetch("/v1/categories", {
      gameId: BEDROCK_GAME_ID.toString(),
    });
    console.log(`CurseForge initialized: using Bedrock Addons class ID ${BEDROCK_ADDONS_CLASS_ID}`);
  } catch (err) {
    console.error("Failed to initialize CurseForge:", err);
  }
}

export async function searchAddons(
  query: string,
  page: number = 0,
  pageSize: number = 20
): Promise<{ results: AddonSearchResult[]; totalCount: number }> {
  if (!config.curseforgeApiKey) {
    return { results: [], totalCount: 0 };
  }

  const params: Record<string, string> = {
    gameId: BEDROCK_GAME_ID.toString(),
    classId: BEDROCK_ADDONS_CLASS_ID.toString(),
    searchFilter: query,
    index: (page * pageSize).toString(),
    pageSize: pageSize.toString(),
    sortField: "2", // Popularity
    sortOrder: "desc",
  };

  const data = await cfFetch("/v1/mods/search", params);

  const results: AddonSearchResult[] = (data.data || []).map((mod: any) => ({
    id: `cf-${mod.id}`,
    source: "curseforge" as const,
    name: mod.name,
    summary: mod.summary || "",
    author: mod.authors?.[0]?.name || "Unknown",
    thumbnailUrl: mod.logo?.thumbnailUrl || "",
    downloadCount: mod.downloadCount,
    pageUrl: mod.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-addons/${mod.slug}`,
    curseforgeId: mod.id,
    curseforgeFileId: mod.mainFileId,
  }));

  return {
    results,
    totalCount: data.pagination?.totalCount || results.length,
  };
}

export async function getAddonDetail(modId: number): Promise<AddonDetail | null> {
  if (!config.curseforgeApiKey) return null;

  // Fetch mod info and full HTML description in parallel
  const [modData, descData, downloadUrlData] = await Promise.all([
    cfFetch(`/v1/mods/${modId}`),
    cfFetch(`/v1/mods/${modId}/description`).catch(() => ({ data: "" })),
    null as any, // placeholder — we fetch download URL after we have mainFileId
  ]);

  const mod = modData.data;
  if (!mod) return null;

  let downloadUrl: string | undefined;
  if (mod.mainFileId) {
    try {
      const fileData = await cfFetch(`/v1/mods/${modId}/files/${mod.mainFileId}/download-url`);
      downloadUrl = fileData.data;
    } catch {
      // Some files don't have direct download URLs
    }
  }

  return {
    id: `cf-${mod.id}`,
    source: "curseforge",
    name: mod.name,
    summary: mod.summary || "",
    description: descData.data || mod.summary || "",
    author: mod.authors?.[0]?.name || "Unknown",
    thumbnailUrl: mod.logo?.url || mod.logo?.thumbnailUrl || "",
    downloadCount: mod.downloadCount,
    pageUrl: mod.links?.websiteUrl || "",
    screenshots: (mod.screenshots || []).map((s: any) => s.url),
    downloadUrl,
    canAutoDownload: !!downloadUrl,
    curseforgeId: mod.id,
    curseforgeFileId: mod.mainFileId,
    categories: (mod.categories || []).map((c: any) => c.name),
    dateCreated: mod.dateCreated,
    dateModified: mod.dateModified,
    latestFileName: mod.latestFiles?.[0]?.fileName,
  };
}

export async function getDownloadUrl(modId: number, fileId: number): Promise<string | null> {
  if (!config.curseforgeApiKey) return null;

  try {
    const data = await cfFetch(`/v1/mods/${modId}/files/${fileId}/download-url`);
    return data.data || null;
  } catch {
    return null;
  }
}
