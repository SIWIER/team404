@echo off
chcp 65001 >nul
cd /d "%~dp0"
title FindMyGlasses Pro - 找眼镜助手正式版
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 22.5+，请先安装
  pause
  exit /b 1
)
echo ================================================
echo   👓 找眼镜助手 · 正式版服务启动中...
echo ================================================
node server.js
pause
