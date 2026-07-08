#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

osascript -e 'tell application "Terminal" to activate' >/dev/null 2>&1 || true

echo "=========================================="
echo "   正在启动大模型评测项目"
echo "=========================================="
echo "项目目录：$SCRIPT_DIR"
echo "将自动选择可用端口并打开浏览器"
echo
echo "停止方式：在本窗口按 Ctrl+C"
echo
bash "$SCRIPT_DIR/start.sh"

echo
echo "服务已停止。按回车键关闭此窗口。"
read -r
