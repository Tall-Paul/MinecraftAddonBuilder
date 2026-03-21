import type { AddonSearchResult, AddonDetail } from "../models/addon.js";

const BASE_URL = "https://api.modrinth.com/v2";
const USER_AGENT = "MinecraftAddonBuilder/1.0 (addon-manager)";

async function mrFetch(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Modrinth API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function searchAddons(
  query: string,
  page: number = 0,
  pageSize: number = 20
): Promise<{ results: AddonSearchResult[]; totalCount: number }> {
  // Modrinth facets: filter for Bedrock platform projects
  // Facets use a nested array format: [["categories:bedrock"]] means AND
  const facets = JSON.stringify([
    ["project_type:mod", "project_type:resourcepack", "project_type:datapack"],
    ["categories:bedrock"],
  ]);

  const data = await mrFetch("/search", {
    query,
    facets,
    offset: (page * pageSize).toString(),
    limit: pageSize.toString(),
  });

  const results: AddonSearchResult[] = (data.hits || []).map((hit: any) => ({
    id: `modrinth-${hit.project_id}`,
    source: "modrinth" as const,
    name: hit.title,
    summary: hit.description || "",
    author: hit.author,
    thumbnailUrl: hit.icon_url || "",
    downloadCount: hit.downloads,
    pageUrl: `https://modrinth.com/${hit.project_type}/${hit.slug}`,
    modrinthId: hit.project_id,
  }));

  return {
    results,
    totalCount: data.total_hits || results.length,
  };
}

export async function getAddonDetail(projectId: string): Promise<AddonDetail | null> {
  const project = await mrFetch(`/project/${projectId}`);
  if (!project) return null;

  // Get the latest version that supports Bedrock
  const versions = await mrFetch(`/project/${projectId}/version`);
  const bedrockVersion = (versions as any[]).find(
    (v: any) =>
      v.loaders?.some((l: string) =>
        ["bedrock", "addon"].includes(l.toLowerCase())
      ) || true // fallback: use latest if no loader filter matches
  );

  let downloadUrl: string | undefined;
  let primaryFileId: string | undefined;

  if (bedrockVersion?.files?.length > 0) {
    const primaryFile =
      bedrockVersion.files.find((f: any) => f.primary) || bedrockVersion.files[0];
    downloadUrl = primaryFile.url;
    primaryFileId = bedrockVersion.id;
  }

  return {
    id: `modrinth-${project.id}`,
    source: "modrinth" as const,
    name: project.title,
    summary: project.description || "",
    description: project.body || project.description || "",
    author: project.team || "Unknown",
    thumbnailUrl: project.icon_url || "",
    downloadCount: project.downloads,
    pageUrl: `https://modrinth.com/${project.project_type}/${project.slug}`,
    screenshots: (project.gallery || []).map((g: any) => g.url),
    downloadUrl,
    canAutoDownload: !!downloadUrl,
    modrinthId: project.id,
    modrinthVersionId: primaryFileId,
  } as AddonDetail & { modrinthId?: string; modrinthVersionId?: string };
}

export async function getDownloadUrl(
  projectId: string,
  versionId?: string
): Promise<string | null> {
  // If we have a specific version, use it
  if (versionId) {
    const version = await mrFetch(`/version/${versionId}`);
    if (version?.files?.length > 0) {
      const primaryFile =
        version.files.find((f: any) => f.primary) || version.files[0];
      return primaryFile.url;
    }
  }

  // Otherwise get latest version
  const versions = await mrFetch(`/project/${projectId}/version`);
  if (versions?.length > 0) {
    const latest = versions[0];
    if (latest.files?.length > 0) {
      const primaryFile =
        latest.files.find((f: any) => f.primary) || latest.files[0];
      return primaryFile.url;
    }
  }

  return null;
}
