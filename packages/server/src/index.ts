import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { config } from "./config.js";
import { initCurseForge } from "./services/curseforge.js";
import { getDb } from "./db/index.js";
import serverRoutes from "./routes/servers.js";
import addonRoutes from "./routes/addons.js";
import installRoutes from "./routes/install.js";
import settingsRoutes from "./routes/settings.js";
import backupRoutes from "./routes/backups.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/servers", serverRoutes);
app.use("/api/addons", addonRoutes);
app.use("/api/install", installRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/backups", backupRoutes);

// Health check
app.get("/api/status", async (_req, res) => {
  let dockerConnected = false;
  try {
    const { listBedrockServers } = await import("./services/docker.js");
    await listBedrockServers();
    dockerConnected = true;
  } catch { /* Docker not available */ }

  res.json({
    status: "ok",
    dockerConnected,
    curseforgeConfigured: !!config.curseforgeApiKey,
    gitCommit: process.env.GIT_COMMIT || "dev",
  });
});

// Serve frontend in production
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(config.clientDist, "index.html"));
  });
}

// Start server
async function start() {
  // Initialize database
  getDb();
  console.log("Database initialized");

  // Ensure cache directory exists
  if (!fs.existsSync(config.cacheDir)) {
    fs.mkdirSync(config.cacheDir, { recursive: true });
  }

  // Initialize CurseForge (non-blocking)
  initCurseForge().catch((err) =>
    console.error("CurseForge init failed:", err)
  );

  // Repair pack registrations for previously installed addons (non-blocking)
  import("./services/installer.js").then(({ repairPackRegistrations }) =>
    repairPackRegistrations().catch((err) =>
      console.error("Pack repair failed:", err)
    )
  );

  // Pre-generate world maps for running servers (non-blocking)
  import("./services/worldmap.js").then(({ preGenerateMaps }) =>
    preGenerateMaps().catch((err) =>
      console.error("Map pre-generation failed:", err)
    )
  );

  // Initialize backup schedule
  import("./services/backup.js").then(({ initBackupSchedule }) =>
    initBackupSchedule()
  );

  app.listen(config.port, () => {
    console.log(`Minecraft Addon Builder running at http://localhost:${config.port}`);
    console.log(`Docker socket: ${config.dockerSocket}`);
    console.log(`CurseForge API: ${config.curseforgeApiKey ? "configured" : "not configured"}`);
  });
}

start().catch(console.error);
