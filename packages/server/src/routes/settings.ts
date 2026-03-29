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

// POST /api/settings/update — trigger an immediate update check
router.post("/update", async (_req, res) => {
  try {
    const docker = new Dockerode({ socketPath: config.dockerSocket });
    const container = docker.getContainer("mc-addon-updater");

    // Verify the updater container is running
    const info = await container.inspect();
    if (info.State.Status !== "running") {
      return res.status(400).json({ error: "Updater container is not running" });
    }

    // Exec the update script inside the updater container
    const exec = await container.exec({
      Cmd: ["sh", "-c", [
        "cd /repo",
        "git fetch origin ${UPDATE_BRANCH:-main} 2>&1",
        "LOCAL=$(git rev-parse HEAD)",
        "REMOTE=$(git rev-parse origin/${UPDATE_BRANCH:-main})",
        "if [ \"$LOCAL\" = \"$REMOTE\" ]; then echo '{\"status\":\"up-to-date\",\"commit\":\"'$(git rev-parse --short HEAD)'\"}'; exit 0; fi",
        "git pull origin ${UPDATE_BRANCH:-main} 2>&1",
        "COMMIT=$(git rev-parse --short HEAD)",
        "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
        "docker compose -f /repo/docker-compose.yml --env-file /dev/null build --build-arg GIT_COMMIT=$COMMIT --build-arg BUILD_TIME=$BUILD_TIME addon-manager 2>&1",
        "docker stop mc-addon-manager 2>&1 || true",
        "docker rm mc-addon-manager 2>&1 || true",
        "docker compose -f /repo/docker-compose.yml --env-file /dev/null up -d --no-deps addon-manager 2>&1",
        "echo '{\"status\":\"updated\",\"commit\":\"'$COMMIT'\"}'",
      ].join(" && ")],
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const stream = await exec.start({ Detach: false, Tty: true });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve) => {
      stream.on("end", resolve);
      stream.on("error", resolve);
    });

    const output = Buffer.concat(chunks).toString("utf-8").trim();
    // Try to parse the last line as JSON status
    const lines = output.split("\n");
    const lastLine = lines[lines.length - 1];
    try {
      const result = JSON.parse(lastLine);
      res.json(result);
    } catch {
      res.json({ status: "done", output: output.substring(0, 500) });
    }
  } catch (err: any) {
    console.error("Failed to trigger update:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
