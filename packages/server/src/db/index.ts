import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.js";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");

    const schemaPath = path.resolve(
      import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
      "schema.sql"
    );

    // If running from dist, schema.sql won't be there — use inline fallback
    const schema = fs.existsSync(schemaPath)
      ? fs.readFileSync(schemaPath, "utf-8")
      : getInlineSchema();

    db.exec(schema);
  }
  return db;
}

function getInlineSchema(): string {
  return `
    CREATE TABLE IF NOT EXISTS installations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      addon_source TEXT NOT NULL,
      addon_source_id TEXT NOT NULL,
      addon_name TEXT NOT NULL,
      packs TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_installations_container ON installations(container_id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS addon_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, source_id)
    );
    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      server_name TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      google_drive_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_backups_container ON backups(container_id);
  `;
}
