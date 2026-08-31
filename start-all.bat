@echo off
rem start-all.bat — 开机一键启动全部后端（主服务 8081 + Chinese-CLIP 8899）
rem 两个窗口各自独立，关窗即停；CLIP 未安装/未部署时自动跳过并提示。
cd /d "%~dp0"

start "find-glasses 后端 8081" cmd /k "node server.js"

if exist "scripts\clip-server\.venv\Scripts\python.exe" (
  start "Chinese-CLIP 8899" cmd /k "scripts\clip-server\.venv\Scripts\python.exe scripts\clip-server\server.py --port 8899 --model ViT-B-16"
) else (
  echo [提示] 未检测到 CLIP 虚拟环境 scripts\clip-server\.venv，
  echo        物品管理"拍照找同款/文字找物品"将降级（文字检索不受影响）。
  echo        需要时按 scripts\clip-server\README.md 部署。
  pause
)
