import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import tar from "tar-stream";
import cron from "node-cron";
import { google } from "googleapis";
import { getDb } from "../db/index.js";
import { config } from "../config.js";
import { getDockerInstance, getServerDetail, detectBasePath, listBedrockServers } from "./docker.js";

export interface Backup {
  id: number;
  container_id: string;
  container_name: string;
  server_name: string | null;
  file_path: string;
  file_size: number;
  google_drive_id: string | null;
  created_at: string;
}

// ── Backup creation ──────────────────────────────────────────────────

/**
 * Create a backup zip of a server's world + addon metadata.
 */
export async function createBackup(containerId: string): Promise<Backup> {
  const server = await getServerDetail(containerId);
  if (!server) throw new Error("Server not found");

  const docker = getDockerInstance();
  const container = docker.getContainer(containerId);
  const basePath = await detectBasePath(container);
  const levelName = server.levelName || "Bedrock level";
  const worldPath = `${basePath}/worlds/${levelName}`;

  fs.mkdirSync(config.backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = (server.serverName || server.containerName).replace(/[^a-zA-Z0-9_-]/g, "_");
  const zipFileName = `backup-${safeName}-${timestamp}.zip`;
  const zipFilePath = path.join(config.backupDir, zipFileName);

  console.log(`backup: creating backup for ${server.containerName} (${containerId})`);

  const zip = new AdmZip();

  // Extract world directory from container and add to zip
  console.log(`backup: extracting world from ${worldPath}`);
  await addContainerDirToZip(container, worldPath, zip, "world");

  // Add installation records as metadata
  const db = getDb();
  const installations = db
    .prepare("SELECT * FROM installations WHERE container_id = ?")
    .all(containerId);
  zip.addFile(
    "metadata/installations.json",
    Buffer.from(JSON.stringify(installations, null, 2))
  );

  // Add server properties
  try {
    const propsContent = await execInContainerRaw(container, ["cat", `${basePath}/server.properties`]);
    if (propsContent) {
      zip.addFile("metadata/server.properties", Buffer.from(propsContent));
    }
  } catch { /* best effort */ }

  // Add permissions.json
  try {
    const permsContent = await execInContainerRaw(container, ["cat", `${basePath}/permissions.json`]);
    if (permsContent) {
      zip.addFile("metadata/permissions.json", Buffer.from(permsContent));
    }
  } catch { /* best effort */ }

  // Add allowlist.json
  try {
    const allowContent = await execInContainerRaw(container, ["cat", `${basePath}/allowlist.json`]);
    if (allowContent) {
      zip.addFile("metadata/allowlist.json", Buffer.from(allowContent));
    }
  } catch { /* best effort */ }

  // Write zip
  zip.writeZip(zipFilePath);
  const stats = fs.statSync(zipFilePath);
  console.log(`backup: created ${zipFileName} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

  // Record in database
  const result = db
    .prepare(
      `INSERT INTO backups (container_id, container_name, server_name, file_path, file_size)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      containerId,
      server.containerName,
      server.serverName || null,
      zipFilePath,
      stats.size
    );

  const backup = db
    .prepare("SELECT * FROM backups WHERE id = ?")
    .get(result.lastInsertRowid) as Backup;

  // Upload to Google Drive if configured
  try {
    const driveId = await uploadToGoogleDrive(zipFilePath, zipFileName);
    if (driveId) {
      db.prepare("UPDATE backups SET google_drive_id = ? WHERE id = ?").run(driveId, backup.id);
      backup.google_drive_id = driveId;
      console.log(`backup: uploaded to Google Drive (${driveId})`);
    }
  } catch (err: any) {
    console.error(`backup: Google Drive upload failed: ${err.message}`);
    if (err.response?.data) {
      console.error(`gdrive: API error details:`, JSON.stringify(err.response.data));
    }
  }

  return backup;
}

// ── Backup listing / management ──────────────────────────────────────

export function listBackups(containerId?: string): Backup[] {
  const db = getDb();
  if (containerId) {
    return db
      .prepare("SELECT * FROM backups WHERE container_id = ? ORDER BY created_at DESC")
      .all(containerId) as Backup[];
  }
  return db
    .prepare("SELECT * FROM backups ORDER BY created_at DESC")
    .all() as Backup[];
}

export function getBackup(id: number): Backup | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM backups WHERE id = ?").get(id) as Backup | undefined;
}

export function deleteBackup(id: number): void {
  const db = getDb();
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(id) as Backup | undefined;
  if (!backup) throw new Error("Backup not found");

  // Delete local file
  try {
    if (fs.existsSync(backup.file_path)) {
      fs.unlinkSync(backup.file_path);
    }
  } catch { /* best effort */ }

  db.prepare("DELETE FROM backups WHERE id = ?").run(id);
}

// ── Scheduled backups ────────────────────────────────────────────────

let scheduledTask: cron.ScheduledTask | null = null;

export function getBackupSchedule(): { enabled: boolean; time: string; containers: string[] } {
  const db = getDb();
  const enabled = (db.prepare("SELECT value FROM settings WHERE key = 'backup_enabled'").get() as any)?.value === "true";
  const time = (db.prepare("SELECT value FROM settings WHERE key = 'backup_time'").get() as any)?.value || "03:00";
  const containers = (db.prepare("SELECT value FROM settings WHERE key = 'backup_containers'").get() as any)?.value || "all";
  return { enabled, time, containers: containers === "all" ? ["all"] : containers.split(",") };
}

export function setBackupSchedule(enabled: boolean, time: string, containers: string[]): void {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  upsert.run("backup_enabled", String(enabled));
  upsert.run("backup_time", time);
  upsert.run("backup_containers", containers.includes("all") ? "all" : containers.join(","));

  // Restart cron
  initBackupSchedule();
}

export function initBackupSchedule(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  const schedule = getBackupSchedule();
  if (!schedule.enabled) {
    console.log("backup: scheduled backups disabled");
    return;
  }

  const [hours, minutes] = schedule.time.split(":").map(Number);
  const cronExpr = `${minutes} ${hours} * * *`;

  scheduledTask = cron.schedule(cronExpr, async () => {
    console.log(`backup: running scheduled backup at ${schedule.time}`);
    try {
      const servers = await listBedrockServers();
      const targets = schedule.containers.includes("all")
        ? servers.filter((s) => s.status === "running")
        : servers.filter((s) => schedule.containers.includes(s.containerId));

      for (const server of targets) {
        try {
          await createBackup(server.containerId);
        } catch (err: any) {
          console.error(`backup: failed for ${server.containerName}: ${err.message}`);
        }
      }

      // Clean up old backups (keep last 7 per server)
      cleanOldBackups(7);
    } catch (err: any) {
      console.error(`backup: scheduled backup failed: ${err.message}`);
    }
  });

  console.log(`backup: scheduled daily at ${schedule.time} (${cronExpr})`);
}

function cleanOldBackups(keepPerServer: number): void {
  const db = getDb();
  const containers = db
    .prepare("SELECT DISTINCT container_id FROM backups")
    .all() as Array<{ container_id: string }>;

  for (const { container_id } of containers) {
    const backups = db
      .prepare("SELECT * FROM backups WHERE container_id = ? ORDER BY created_at DESC")
      .all(container_id) as Backup[];

    for (const old of backups.slice(keepPerServer)) {
      try {
        if (fs.existsSync(old.file_path)) {
          fs.unlinkSync(old.file_path);
        }
      } catch { /* best effort */ }
      db.prepare("DELETE FROM backups WHERE id = ?").run(old.id);
    }
  }
}

// ── Google Drive integration ─────────────────────────────────────────

export function getGoogleDriveConfig(): { configured: boolean; folderId: string } {
  const db = getDb();
  const credPath = (db.prepare("SELECT value FROM settings WHERE key = 'gdrive_credentials_path'").get() as any)?.value;
  const folderId = (db.prepare("SELECT value FROM settings WHERE key = 'gdrive_folder_id'").get() as any)?.value || "";
  return { configured: !!credPath && fs.existsSync(credPath), folderId };
}

export function setGoogleDriveConfig(credentialsPath: string, folderId: string): void {
  if (credentialsPath && !fs.existsSync(credentialsPath)) {
    throw new Error(`Credentials file not found: ${credentialsPath}`);
  }
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  upsert.run("gdrive_credentials_path", credentialsPath);
  upsert.run("gdrive_folder_id", folderId);
}

async function uploadToGoogleDrive(filePath: string, fileName: string): Promise<string | null> {
  const db = getDb();
  const credPath = (db.prepare("SELECT value FROM settings WHERE key = 'gdrive_credentials_path'").get() as any)?.value;
  const folderId = (db.prepare("SELECT value FROM settings WHERE key = 'gdrive_folder_id'").get() as any)?.value;

  console.log(`gdrive: credentials path = ${credPath || "(not set)"}`);
  console.log(`gdrive: folder ID = ${folderId || "(not set)"}`);

  if (!credPath) {
    console.log("gdrive: no credentials path configured, skipping upload");
    return null;
  }
  if (!fs.existsSync(credPath)) {
    console.log(`gdrive: credentials file not found at ${credPath}, skipping upload`);
    return null;
  }

  console.log(`gdrive: authenticating with service account...`);
  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  const drive = google.drive({ version: "v3", auth });

  const fileMetadata: any = { name: fileName };
  if (folderId) {
    fileMetadata.parents = [folderId];
    console.log(`gdrive: uploading "${fileName}" to folder ${folderId}`);
  } else {
    console.log(`gdrive: uploading "${fileName}" to root (no folder ID configured)`);
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`gdrive: file size = ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

  const media = {
    mimeType: "application/zip",
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id",
  });

  console.log(`gdrive: upload complete, file ID = ${response.data.id}`);
  return response.data.id || null;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function execInContainerRaw(container: any, cmd: string[]): Promise<string> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });
  const stream = await exec.start({ Tty: true });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

async function addContainerDirToZip(
  container: any,
  containerPath: string,
  zip: AdmZip,
  zipPrefix: string
): Promise<void> {
  const stream = await container.getArchive({ path: containerPath });

  return new Promise((resolve, reject) => {
    const extract = tar.extract();

    extract.on("entry", (header, entryStream, next) => {
      const parts = header.name.split("/");
      parts.shift(); // strip leading dir
      const relativePath = parts.join("/");

      if (!relativePath || header.type === "directory") {
        entryStream.resume();
        next();
        return;
      }

      const chunks: Buffer[] = [];
      entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      entryStream.on("end", () => {
        const data = Buffer.concat(chunks);
        zip.addFile(`${zipPrefix}/${relativePath}`, data);
        next();
      });
      entryStream.on("error", next);
    });

    extract.on("finish", resolve);
    extract.on("error", reject);

    stream.pipe(extract);
  });
}
