#!/usr/bin/env bash
# Runs the Cadence Log smoke test: starts a static server for the repo, runs the headless
# Playwright checks against it, then tears the server down. Exits non-zero if any check fails.
#
#   bash test/run-smoke.sh          # default port 8000
#   PORT=8123 bash test/run-smoke.sh
#   HEADFUL=1 bash test/run-smoke.sh   # watch it in a real browser window
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PORT="${PORT:-8000}"

# --- locate the playwright package ---------------------------------------------------
# Prefer a local install (test/node_modules); otherwise fall back to a global npx cache
# copy so the test runs without a dedicated `npm install` on machines that already have
# playwright cached.
if node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  : # already resolvable
elif [ -d "$HERE/node_modules/playwright" ]; then
  export NODE_PATH="$HERE/node_modules"
else
  CACHED="$(ls -d "$HOME"/.npm/_npx/*/node_modules 2>/dev/null | while read -r d; do [ -d "$d/playwright" ] && echo "$d" && break; done)"
  if [ -n "${CACHED:-}" ]; then
    export NODE_PATH="$CACHED"
  else
    echo "playwright not found. Run:  cd test && npm install" >&2
    exit 2
  fi
fi

# --- start the static server ---------------------------------------------------------
python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# wait for it to accept connections
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$PORT/bike-tracker.html"; then break; fi
  sleep 0.25
done

echo "Running smoke test against http://localhost:$PORT ..."
BASE_URL="http://localhost:$PORT" node "$HERE/smoke.js"