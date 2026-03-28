import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { config } from "../config.js";
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

const upload = multer({ dest: path.join(config.cacheDir, "uploads") });

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

// POST /api/backups/gdrive — Upload credentials file and update config
router.post("/gdrive", upload.single("credentials"), async (req, res) => {
  try {
    const folderId = req.body.folderId || "";
    let credentialsPath = "";

    if (req.file) {
      // Validate it's valid JSON with expected fields
      const content = fs.readFileSync(req.file.path, "utf-8");
      const parsed = JSON.parse(content);
      if (!parsed.client_email || !parsed.private_key) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid service account key: missing client_email or private_key" });
      }

      // Move to data dir with a stable name
      credentialsPath = path.join(path.dirname(config.dbPath), "google-credentials.json");
      fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
      fs.renameSync(req.file.path, credentialsPath);
    }

    setGoogleDriveConfig(credentialsPath, folderId);
    res.json(getGoogleDriveConfig());
  } catch (err: any) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/backups/gdrive — Update folder ID only
router.put("/gdrive", async (req, res) => {
  try {
    const { folderId } = req.body;
    // Get existing creds path so we don't overwrite it
    const db = await import("../db/index.js");
    const existing = (db.getDb().prepare("SELECT value FROM settings WHERE key = 'gdrive_credentials_path'").get() as any)?.value || "";
    setGoogleDriveConfig(existing, folderId || "");
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
