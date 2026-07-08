#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_VENV="$BACKEND_DIR/.venv"
PYTHON_BIN="$BACKEND_VENV/bin/python"
NODE_BIN="/Users/yaochengzhi/.local/codex-node/node-v24.14.0-darwin-arm64/bin"
PREFERRED_BACKEND_PORT="8000"
PREFERRED_FRONTEND_PORT="3000"
HOST="localhost"

cleanup() {
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    pkill -TERM -P "$FRONTEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    pkill -TERM -P "$BACKEND_PID" 2>/dev/null || true
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

is_port_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

pick_port() {
  local port="$1"
  local max_port=$((port + 100))

  while [ "$port" -le "$max_port" ]; do
    if is_port_free "$port"; then
      printf "%s\n" "$port"
      return 0
    fi
    port=$((port + 1))
  done

  echo "从 $1 到 $max_port 都没有可用端口。" >&2
  return 1
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local pid="$3"
  local attempts=80
  local count=1

  while [ "$count" -le "$attempts" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name 进程已退出，请查看上面的日志。"
      return 1
    fi

    sleep 0.5
    count=$((count + 1))
  done

  echo "$name 启动超时：$url"
  return 1
}

if [ ! -d "$BACKEND_DIR" ]; then
  echo "未找到后端目录：$BACKEND_DIR"
  exit 1
fi

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "未找到前端目录：$FRONTEND_DIR"
  exit 1
fi

if [ ! -d "$BACKEND_VENV" ]; then
  echo "未找到后端虚拟环境：$BACKEND_VENV"
  echo "请先在 backend 目录创建并安装依赖。"
  exit 1
fi

if [ ! -x "$PYTHON_BIN" ]; then
  echo "未找到后端 Python：$PYTHON_BIN"
  echo "请先在 backend 目录重新创建虚拟环境。"
  exit 1
fi

if [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请先安装 Node.js 或检查 PATH。"
  exit 1
fi

BACKEND_PORT="$(pick_port "$PREFERRED_BACKEND_PORT")"
FRONTEND_PORT="$(pick_port "$PREFERRED_FRONTEND_PORT")"
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
FRONTEND_URL="http://$HOST:$FRONTEND_PORT"

echo "后端端口：$BACKEND_PORT"
echo "前端端口：$FRONTEND_PORT"
echo
echo "启动后端 $BACKEND_URL"
(
  cd "$BACKEND_DIR"
  export VIRTUAL_ENV="$BACKEND_VENV"
  export PATH="$BACKEND_VENV/bin:$PATH"
  export CORS_ORIGINS="$FRONTEND_URL,http://127.0.0.1:$FRONTEND_PORT"
  exec "$PYTHON_BIN" -m uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

wait_for_http "$BACKEND_URL/api/health" "后端" "$BACKEND_PID"

echo
echo "启动前端 $FRONTEND_URL"
(
  cd "$FRONTEND_DIR"
  export VITE_API_BASE="$BACKEND_URL"
  exec npm run dev -- --host "$HOST" --port "$FRONTEND_PORT" --strictPort
) &
FRONTEND_PID=$!

wait_for_http "$FRONTEND_URL" "前端" "$FRONTEND_PID"

echo
echo "浏览器打开：$FRONTEND_URL"
echo "按 Ctrl+C 可同时停止本窗口启动的前后端。"
open "$FRONTEND_URL" >/dev/null 2>&1 || true

wait "$FRONTEND_PID"
