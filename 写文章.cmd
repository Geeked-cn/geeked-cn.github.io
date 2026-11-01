@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   需要先安装 Node.js：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem 后台起服务（窗口隐藏），服务自己会把写作窗口弹出来。
rem 如果已经在运行，新进程会直接把已有窗口唤到前面。
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ^
  "Start-Process -FilePath 'node' -ArgumentList 'tools/writer/server.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

exit /b 0
