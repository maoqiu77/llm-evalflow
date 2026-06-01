#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_VENV="$BACKEND_DIR/.venv"
NODE_BIN="/Users/yaochengzhi/.local/codex-node/node-v24.14.0-darwin-arm64/bin"
BACKEND_PORT="8000"
FRONTEND_PORT="5173"

cleanup() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

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

if [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请先安装 Node.js 或检查 PATH。"
  exit 1
fi

echo "启动后端 http://127.0.0.1:$BACKEND_PORT"
(
  cd "$BACKEND_DIR"
  source "$BACKEND_VENV/bin/activate"
  exec python -m uvicorn app.main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

sleep 2

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "后端启动失败，请检查 backend 日志输出。"
  exit 1
fi

echo "启动前端 http://127.0.0.1:$FRONTEND_PORT"
echo "按 Ctrl+C 可同时停止前后端。"
cd "$FRONTEND_DIR"
exec npm run dev -- --port "$FRONTEND_PORT"
