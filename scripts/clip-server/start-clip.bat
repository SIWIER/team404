@echo off
rem start-clip.bat — one-click launcher for the Chinese-CLIP local inference service
rem Used by item management "search by photo / search by text" vector retrieval.
rem First run downloads the ViT-B-16 weights (~700MB) into scripts\clip-server\models\.
rem The port stays closed until the model is fully loaded.
cd /d "%~dp0..\.."
"scripts\clip-server\.venv\Scripts\python.exe" "scripts\clip-server\server.py" --port 8899 --model ViT-B-16
echo.
echo [clip-server] service exited. Press any key to close this window.
pause >nul
