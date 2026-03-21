import { Router } from "express";
import Dockerode from "dockerode";
import { getSettings, updateSettings } from "../services/settings.js";
import { config } from "../config.js";

const router = Router();

// GET /api/settings
router.get("/", (_req, res) => {
  try {
    const settings = getSettings();
    res.json(settings);
  } catch (err: any) {
    console.error("Failed to get settings:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/networks — list Docker networks
router.get("/networks", async (_req, res) => {
  try {
    const docker = new Dockerode({ socketPath: config.dockerSocket });
    const networks = await docker.listNetworks();
    const result = networks
      .map((n) => ({
        name: n.Name,
        driver: n.Driver,
        scope: n.Scope,
        subnet: n.IPAM?.Config?.[0]?.Subnet || "",
      }))
      .filter((n) => n.name !== "none" && n.name !== "host")
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(result);
  } catch (err: any) {
    console.error("Failed to list networks:", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put("/", (req, res) => {
  try {
    const settings = updateSettings(req.body);
    res.json(settings);
  } catch (err: any) {
    console.error("Failed to update settings:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
