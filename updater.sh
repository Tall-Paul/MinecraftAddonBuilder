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

# Detect the compose project name from the running addon-manager container's labels
PROJECT_NAME=$(docker inspect mc-addon-manager --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo "")
if [ -z "$PROJECT_NAME" ]; then
  echo "updater: WARNING — could not detect project name, falling back to 'minecraftaddonbuilder'"
  PROJECT_NAME="minecraftaddonbuilder"
fi

COMPOSE="docker compose -p $PROJECT_NAME -f /repo/docker-compose.yml"
echo "updater: watching branch '$BRANCH' every ${INTERVAL}s (project=$PROJECT_NAME)"

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

  echo "updater: rebuilding and restarting app..."

  # Rebuild only the app service and recreate it
  # --no-deps avoids restarting the updater itself
  COMMIT=$(git rev-parse --short HEAD)
  $COMPOSE build --build-arg "GIT_COMMIT=$COMMIT" addon-manager 2>&1
  $COMPOSE up -d --no-deps addon-manager 2>&1

  echo "updater: done, app restarted with $(git rev-parse --short HEAD)"
done
