import { Router } from "express";
import path from "path";
import {
  createBackup,
  listBackups,
  getBackup,
  deleteBackup,
  getBackupSchedule,
  setBackupSchedule,
  getGoogleDriveConfig,
  setGoogleDriveConfig,
} from "../services/backup.js";

const router = Router();

// ── Static routes first (before :param routes) ──────────────────────

// GET /api/backups/schedule — Get backup schedule config
router.get("/schedule", async (_req, res) => {
  try {
    const schedule = getBackupSchedule();
    res.json(schedule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/backups/schedule — Update backup schedule
router.put("/schedule", async (req, res) => {
  try {
    const { enabled, time, containers } = req.body;
    setBackupSchedule(!!enabled, time || "03:00", containers || ["all"]);
    res.json(getBackupSchedule());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backups/gdrive — Get Google Drive config status
router.get("/gdrive", async (_req, res) => {
  try {
    res.json(getGoogleDriveConfig());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/backups/gdrive — Update Google Drive config
router.put("/gdrive", async (req, res) => {
  try {
    const { credentialsPath, folderId } = req.body;
    setGoogleDriveConfig(credentialsPath || "", folderId || "");
    res.json(getGoogleDriveConfig());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Parameterized routes ─────────────────────────────────────────────

// GET /api/backups — List all backups (optionally filter by containerId)
router.get("/", async (_req, res) => {
  try {
    const containerId = _req.query.containerId as string | undefined;
    const backups = listBackups(containerId);
    res.json({ backups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backups/:containerId — Create a backup for a server
router.post("/:containerId", async (req, res) => {
  try {
    const backup = await createBackup(req.params.containerId);
    res.json({ backup });
  } catch (err: any) {
    console.error("Failed to create backup:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backups/:id/download — Download a backup zip
router.get("/:id/download", async (req, res) => {
  try {
    const backup = getBackup(parseInt(req.params.id, 10));
    if (!backup) {
      return res.status(404).json({ error: "Backup not found" });
    }

    const fileName = path.basename(backup.file_path);
    res.download(backup.file_path, fileName);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/backups/:id — Delete a backup
router.delete("/:id", async (req, res) => {
  try {
    deleteBackup(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
