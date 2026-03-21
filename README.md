# Eden's Minecraft Manager

A web application for searching, downloading, and installing Minecraft Bedrock Edition addons into Docker-hosted Bedrock servers.

## Features

- **Addon Search** — Browse thousands of Bedrock addons from CurseForge with in-app detail pages, descriptions, and screenshots
- **One-Click Install** — Download and install addons directly into running Bedrock server containers
- **Manual Upload** — Upload `.mcaddon` or `.mcpack` files and install them into any server
- **Server Management** — Create, start, stop, restart, and delete Bedrock server containers from the UI
- **Auto Networking** — Automatically assigns ports (bridge mode) or static IPs (macvlan mode) from a configurable pool, with availability checking
- **Flexible Storage** — Configure a host path for world data or use Docker named volumes
- **Settings Page** — Configure network mode, IP/port ranges, data paths, and default server settings

## Architecture

Monorepo with two packages:

- **`packages/server`** — Node.js + Express + TypeScript backend
  - CurseForge API integration (Bedrock gameId `78022`, Addons classId `4984`)
  - Docker management via Dockerode (container lifecycle, file operations via `putArchive`)
  - Addon extraction and installation (`.mcaddon`/`.mcpack` parsing, pack registration)
  - SQLite database (installations, settings, addon cache)

- **`packages/client`** — React 18 + Vite + Tailwind CSS frontend
  - React Router for navigation
  - React Query for data fetching
  - Addon search, detail pages, and install modals
  - Server management with create/start/stop/restart/delete controls

## Prerequisites

- Docker and Docker Compose
- A [CurseForge API key](https://console.curseforge.com/) (free)

## Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/Tall-Paul/MinecraftAddonBuilder.git
   cd MinecraftAddonBuilder
   ```

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Add your CurseForge API key to `.env`:
   ```
   CURSEFORGE_API_KEY=your_key_here
   ```

4. Build and run:
   ```bash
   docker compose up -d --build
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CURSEFORGE_API_KEY` | — | Required. API key from console.curseforge.com |
| `PORT` | `3000` | Web UI port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Path to Docker socket |

### In-App Settings

Visit the **Settings** page to configure:

- **Network Mode** — Bridge (port mapping) or Static IP (macvlan)
- **Port/IP Range** — Pool of ports or IPs to auto-assign to new servers
- **Data Base Path** — Host directory for server world data
- **Server Defaults** — Default game mode, difficulty, max players, cheats

## Docker Compose

The app runs as a single container alongside your Bedrock servers:

```yaml
services:
  addon-manager:
    build: .
    container_name: mc-addon-manager
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - addon-data:/app/data
      - ./.env:/app/.env:ro
    restart: unless-stopped
```

The Docker socket mount is required so the app can manage Bedrock server containers.

## How Addon Installation Works

1. Downloads the addon file from CurseForge (or accepts a manual upload)
2. Extracts `.mcaddon` (ZIP of `.mcpack` files) or individual `.mcpack` files
3. Reads each pack's `manifest.json` to determine type (behavior/resource)
4. Copies pack directories into the container via Docker's `putArchive` API
5. Registers packs in `world_behavior_packs.json` / `world_resource_packs.json`
6. Records the installation in SQLite for tracking and uninstall support

## License

MIT
