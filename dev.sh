#!/usr/bin/env bash
# Local dev runner for SJEL Stitch.
#
# Runs the backend as the real Docker image (Inkscape-free Ink/Stitch CLI
# bundle + potrace, see backend/Dockerfile) on :8001, and the Vite
# frontend dev server on :5173, together — Ctrl-C stops both.
#
# Real conversions need the actual Ink/Stitch CLI + potrace, which only
# exist inside this Docker image (see docs/HOTSPOTS.md). There is no
# bare-venv fallback anymore: a plain `uvicorn` process on the host can
# serve /health but every /convert call will fail, which is exactly the
# bug this script used to hide (see docs/LOGBOOK.md, 2026-09-23 debug
# session). Docker is required to actually test conversions locally.
#
# Flags:
#   --rebuild   force a fresh `docker build` even if the image exists

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
IMAGE="stitch-backend"
CONTAINER="stitch-backend-dev"

REBUILD=false
[[ "${1:-}" == "--rebuild" ]] && REBUILD=true

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required (backend needs the real Ink/Stitch CLI + potrace)." >&2
  echo "Install Docker Desktop, or see docs/HOTSPOTS.md for why a bare venv isn't enough." >&2
  exit 1
fi

FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Stopping..."
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- backend: docker image + container ---
if $REBUILD || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Building backend image (Inkscape-free Ink/Stitch CLI + potrace, ~1.5GB, first build downloads a ~170MB release asset)"
  docker build -t "$IMAGE" "$BACKEND_DIR"
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "==> Starting backend on http://localhost:8001"
docker run -d --rm --name "$CONTAINER" -p 8001:8001 "$IMAGE" >/dev/null

# wait for it to actually come up before moving on
for _ in $(seq 1 30); do
  curl -sf http://localhost:8001/health >/dev/null 2>&1 && break
  sleep 0.5
done

# --- frontend: npm deps ---
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "==> Installing frontend deps"
  (cd "$FRONTEND_DIR" && npm install)
fi

echo "==> Starting frontend on http://localhost:5173"
(cd "$FRONTEND_DIR" && npm run dev -- --port 5173) &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://localhost:8001/health  (container: $CONTAINER)"
echo "Frontend: http://localhost:5173"
echo "(Ctrl-C to stop both)"
echo ""

wait
