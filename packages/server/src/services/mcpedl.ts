import * as cheerio from "cheerio";
import type { AddonSearchResult, AddonDetail } from "../models/addon.js";

const BASE_URL = "https://mcpedl.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Rate limiting: max 1 request per 2 seconds
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;

async function rateLimitedFetch(url: string): Promise<string | null> {
  const now = Date.now();
  const wait = MIN_REQUEST_INTERVAL - (now - lastRequestTime);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestTime = Date.now();

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      console.warn(`MCPEDL returned ${res.status} for ${url}`);
      return null;
    }

    return res.text();
  } catch (err) {
    console.error(`MCPEDL fetch error for ${url}:`, err);
    return null;
  }
}

export async function searchAddons(
  query: string,
  page: number = 1
): Promise<{ results: AddonSearchResult[]; hasMore: boolean }> {
  const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=post&paged=${page}`;
  const html = await rateLimitedFetch(searchUrl);

  if (!html) {
    return { results: [], hasMore: false };
  }

  const $ = cheerio.load(html);
  const results: AddonSearchResult[] = [];

  // MCPEDL search results are typically article elements
  $("article, .post-item, .search-result").each((_i, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2 a, .entry-title a, h3 a").first();
    const title = titleEl.text().trim();
    const link = titleEl.attr("href") || "";

    if (!title || !link) return;

    const summary =
      $el.find(".entry-summary, .post-excerpt, p").first().text().trim().substring(0, 200) || "";
    const thumbnail = $el.find("img").first().attr("src") || "";
    const author = $el.find(".author, .post-author").first().text().trim() || "Unknown";

    // Extract a slug-based ID from the URL
    const slug = link.replace(BASE_URL, "").replace(/\//g, "").trim();

    results.push({
      id: `mcpedl-${slug}`,
      source: "mcpedl",
      name: title,
      summary,
      author,
      thumbnailUrl: thumbnail,
      pageUrl: link.startsWith("http") ? link : `${BASE_URL}${link}`,
    });
  });

  // Check if there's a next page
  const hasMore = $(".next, .pagination .next, a.next").length > 0;

  return { results, hasMore };
}

export async function getAddonDetail(slug: string): Promise<AddonDetail | null> {
  const url = `${BASE_URL}/${slug}/`;
  const html = await rateLimitedFetch(url);

  if (!html) return null;

  const $ = cheerio.load(html);

  const name = $("h1.entry-title, h1").first().text().trim();
  const description = $(".entry-content, .post-content").first().text().trim().substring(0, 2000);
  const author = $(".author, .post-author, .entry-author").first().text().trim() || "Unknown";
  const thumbnail = $(".entry-content img, .post-content img").first().attr("src") || "";

  const screenshots: string[] = [];
  $(".entry-content img, .post-content img").each((_i, el) => {
    const src = $(el).attr("src");
    if (src) screenshots.push(src);
  });

  return {
    id: `mcpedl-${slug}`,
    source: "mcpedl",
    name: name || slug,
    summary: description.substring(0, 200),
    description,
    author,
    thumbnailUrl: thumbnail,
    pageUrl: url,
    screenshots: screenshots.slice(0, 10),
    // MCPEDL downloads go through ad intermediaries — can't auto-download
    canAutoDownload: false,
  };
}
