#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── free a port if something is already listening on it ───────────────────────
free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  [!] Port $port in use — killing PID(s): $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
}

echo ""
echo "==> Clearing ports..."
free_port 8000
free_port 3000

echo ""
echo "==> Starting backend..."
cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
  echo "  [+] Creating Python venv..."
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
.venv/bin/uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

echo ""
echo "==> Starting frontend..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend  → http://localhost:8000"
echo "  Frontend → http://localhost:3000"
echo ""
echo "  Press Ctrl+C to stop both."
echo ""

trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
