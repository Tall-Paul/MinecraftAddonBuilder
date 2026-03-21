import { Router } from "express";
import multer from "multer";
import { downloadAddon, saveUploadedAddon } from "../services/addon.js";
import { installAddon, uninstallAddon } from "../services/installer.js";
import * as curseforge from "../services/curseforge.js";
import * as modrinth from "../services/modrinth.js";
import { config } from "../config.js";

const router = Router();
const upload = multer({
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase();
    if (ext.endsWith(".mcaddon") || ext.endsWith(".mcpack") || ext.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only .mcaddon, .mcpack, and .zip files are accepted"));
    }
  },
});

// POST /api/install/download — Download addon from source and install to server
router.post("/download", async (req, res) => {
  const { containerId, source, sourceId, name, modId, fileId, modrinthId, modrinthVersionId } = req.body;

  if (!containerId || !source || !sourceId) {
    return res.status(400).json({
      error: "containerId, source, and sourceId are required",
    });
  }

  try {
    let downloadUrl: string | undefined;

    if (source === "curseforge" && modId && fileId) {
      downloadUrl = (await curseforge.getDownloadUrl(modId, fileId)) || undefined;
    } else if (source === "modrinth" && modrinthId) {
      downloadUrl = (await modrinth.getDownloadUrl(modrinthId, modrinthVersionId)) || undefined;
    }

    if (!downloadUrl) {
      return res.status(400).json({
        error: "Could not determine download URL. Try manual upload instead.",
      });
    }

    // Download the addon
    const filePath = await downloadAddon(downloadUrl, source, sourceId, name || "addon");

    // Install into the server container
    const result = await installAddon(
      containerId,
      filePath,
      source,
      sourceId,
      name || "addon"
    );

    if (result.success) {
      res.json({
        message: `Successfully installed ${result.installedPacks.length} pack(s)`,
        ...result,
      });
    } else {
      res.status(500).json({
        message: "Installation failed",
        ...result,
      });
    }
  } catch (err: any) {
    console.error("Download+install error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/install/upload — Upload a local .mcaddon/.mcpack file and install
router.post("/upload", upload.single("addon"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const { containerId } = req.body;
  if (!containerId) {
    return res.status(400).json({ error: "containerId is required" });
  }

  try {
    const sourceId = `upload-${Date.now()}`;
    const filePath = saveUploadedAddon(
      req.file.buffer,
      req.file.originalname,
      "upload",
      sourceId
    );

    const result = await installAddon(
      containerId,
      filePath,
      "upload",
      sourceId,
      req.file.originalname
    );

    if (result.success) {
      res.json({
        message: `Successfully installed ${result.installedPacks.length} pack(s)`,
        ...result,
      });
    } else {
      res.status(500).json({
        message: "Installation failed",
        ...result,
      });
    }
  } catch (err: any) {
    console.error("Upload+install error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/install/:containerId/:installationId — Uninstall addon
router.delete("/:containerId/:installationId", async (req, res) => {
  try {
    const { containerId, installationId } = req.params;
    const result = await uninstallAddon(containerId, parseInt(installationId, 10));

    if (result.success) {
      res.json({ message: "Addon uninstalled successfully" });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
