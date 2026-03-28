import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  dockerSocket: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
  curseforgeApiKey: process.env.CURSEFORGE_API_KEY || "",
  bedrockImageFilter: (process.env.BEDROCK_IMAGE_FILTER || "itzg/minecraft-bedrock-server,binhex/arch-minecraftbedrockserver,bedrock")
    .split(",")
    .map((s) => s.trim()),
  cacheDir: process.env.CACHE_DIR || path.resolve(process.cwd(), "data/cache"),
  backupDir: process.env.BACKUP_DIR || path.resolve(process.cwd(), "data/backups"),
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), "data/addons.db"),
  clientDist: path.resolve(process.cwd(), "packages/client/dist"),
};
