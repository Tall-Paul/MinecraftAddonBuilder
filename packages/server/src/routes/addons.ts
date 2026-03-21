import { Router } from "express";
import * as curseforge from "../services/curseforge.js";
import * as mcpedl from "../services/mcpedl.js";
import { config } from "../config.js";

const router = Router();

// GET /api/addons/search?q=&source=curseforge|mcpedl|all&page=0
router.get("/search", async (req, res) => {
  const query = (req.query.q as string) || "";
  const source = (req.query.source as string) || "all";
  const page = parseInt((req.query.page as string) || "0", 10);

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const results: any[] = [];
    let totalCount = 0;

    // Run enabled sources in parallel
    const searches: Promise<void>[] = [];

    if ((source === "curseforge" || source === "all") && config.curseforgeApiKey) {
      searches.push(
        curseforge.searchAddons(query, page).then((cf) => {
          results.push(...cf.results);
          totalCount += cf.totalCount;
        }).catch((err) => {
          console.error("CurseForge search error:", err);
        })
      );
    }

    if (source === "mcpedl" || source === "all") {
      searches.push(
        mcpedl.searchAddons(query, page + 1).then((mp) => {
          results.push(...mp.results);
          if (mp.hasMore) totalCount += results.length + 1;
        }).catch((err) => {
          console.error("MCPEDL search error:", err);
        })
      );
    }

    await Promise.all(searches);

    res.json({ results, totalCount, page });
  } catch (err: any) {
    console.error("Addon search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/addons/curseforge/:modId
router.get("/curseforge/:modId", async (req, res) => {
  try {
    const modId = parseInt(req.params.modId, 10);
    const detail = await curseforge.getAddonDetail(modId);
    if (!detail) {
      return res.status(404).json({ error: "Addon not found" });
    }
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/addons/mcpedl/:slug
router.get("/mcpedl/:slug", async (req, res) => {
  try {
    const detail = await mcpedl.getAddonDetail(req.params.slug);
    if (!detail) {
      return res.status(404).json({ error: "Addon not found" });
    }
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
