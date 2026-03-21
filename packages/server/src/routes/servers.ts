import { Router } from "express";
import {
  listBedrockServers,
  getServerDetail,
  createServer,
  startServer,
  stopServer,
  restartServer,
  deleteServer,
} from "../services/docker.js";
import { getInstallations } from "../services/installer.js";

const router = Router();

// GET /api/servers — List detected Bedrock server containers
router.get("/", async (_req, res) => {
  try {
    const servers = await listBedrockServers();
    res.json({ servers });
  } catch (err: any) {
    console.error("Failed to list servers:", err);
    res.status(500).json({
      error: "Failed to connect to Docker. Is the Docker socket mounted?",
      details: err.message,
    });
  }
});

// GET /api/servers/:id — Get server details including installed packs
router.get("/:id", async (req, res) => {
  try {
    const detail = await getServerDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ error: "Server not found" });
    }

    const installations = getInstallations(req.params.id);

    res.json({ server: detail, installations });
  } catch (err: any) {
    console.error("Failed to get server detail:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/servers — Create a new Bedrock server
router.post("/", async (req, res) => {
  const {
    name,
    serverName,
    gameMode = "survival",
    difficulty = "normal",
    maxPlayers = 10,
    allowCheats = false,
  } = req.body;

  if (!name || !serverName) {
    return res.status(400).json({ error: "name and serverName are required" });
  }

  try {
    const server = await createServer({
      name,
      serverName,
      gameMode,
      difficulty,
      maxPlayers,
      allowCheats,
    });
    res.status(201).json({ server });
  } catch (err: any) {
    console.error("Failed to create server:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/servers/:id/start
router.post("/:id/start", async (req, res) => {
  try {
    await startServer(req.params.id);
    res.json({ message: "Server started" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/servers/:id/stop
router.post("/:id/stop", async (req, res) => {
  try {
    await stopServer(req.params.id);
    res.json({ message: "Server stopped" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/servers/:id/restart
router.post("/:id/restart", async (req, res) => {
  try {
    await restartServer(req.params.id);
    res.json({ message: "Server restarted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/servers/:id
router.delete("/:id", async (req, res) => {
  try {
    await deleteServer(req.params.id);
    res.json({ message: "Server deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
