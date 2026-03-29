#!/bin/sh
# Auto-updater: polls git for new commits and rebuilds the app container.
# Runs as a sidecar container alongside the main app.

INTERVAL="${UPDATE_INTERVAL:-300}"  # default: check every 5 minutes
BRANCH="${UPDATE_BRANCH:-main}"
REPO_DIR="/repo"

cd "$REPO_DIR" || exit 1

# Mark the repo as safe (mounted from host, different uid)
git config --global --add safe.directory "$REPO_DIR"

# If a GitHub token is provided, configure git to use it for HTTPS auth
if [ -n "$GIT_TOKEN" ]; then
  git config --global credential.helper '!f() { echo "password=$GIT_TOKEN"; }; f'
  # Rewrite origin URL to include token for fetch/pull
  ORIGIN_URL=$(git remote get-url origin)
  if echo "$ORIGIN_URL" | grep -q "https://github.com/"; then
    AUTH_URL=$(echo "$ORIGIN_URL" | sed "s|https://github.com/|https://x-access-token:${GIT_TOKEN}@github.com/|")
    git remote set-url origin "$AUTH_URL"
    echo "updater: configured token auth for GitHub"
  fi
fi

# Capture the current container's config so we can recreate it
# (volumes, ports, env, restart policy are all defined here)
IMAGE_NAME="repo-addon-manager"
CONTAINER_NAME="mc-addon-manager"

echo "updater: watching branch '$BRANCH' every ${INTERVAL}s"

while true; do
  sleep "$INTERVAL"

  # Fetch latest from remote
  if ! git fetch origin "$BRANCH" 2>&1; then
    echo "updater: git fetch failed, will retry"
    continue
  fi

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")

  if [ "$LOCAL" = "$REMOTE" ]; then
    echo "updater: up to date ($LOCAL)"
    continue
  fi

  echo "updater: new commits detected ($LOCAL -> $REMOTE)"
  echo "updater: pulling changes..."

  if ! git pull origin "$BRANCH" 2>&1; then
    echo "updater: git pull failed, will retry next cycle"
    continue
  fi

  echo "updater: rebuilding app image..."
  COMMIT=$(git rev-parse --short HEAD)

  # Build the new image using docker compose (for build context/args)
  BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  docker compose -f /repo/docker-compose.yml --env-file /dev/null build --build-arg "GIT_COMMIT=$COMMIT" --build-arg "BUILD_TIME=$BUILD_TIME" addon-manager 2>&1

  echo "updater: stopping old container..."
  docker stop "$CONTAINER_NAME" 2>&1 || true
  docker rm "$CONTAINER_NAME" 2>&1 || true

  echo "updater: starting new container..."
  docker compose -f /repo/docker-compose.yml --env-file /dev/null up -d --no-deps addon-manager 2>&1

  echo "updater: done, app restarted with $COMMIT"
done
