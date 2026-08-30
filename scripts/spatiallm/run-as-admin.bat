@echo off
rem run-as-admin.bat — double-click to elevate and run wsl-install.ps1 with full logging.
rem Logs go to %TEMP%\wsl-install-bat.log (check it when the window flashes and closes).
set "LOG=%TEMP%\wsl-install-bat.log"
echo ===== start %date% %time% ===== > "%LOG%"
whoami >> "%LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wsl-install.ps1" >> "%LOG%" 2>&1
echo ===== exit %ERRORLEVEL% ===== >> "%LOG%"
echo done > "%TEMP%\wsl-install.done"
echo.
echo Log written to: %LOG%
pause
