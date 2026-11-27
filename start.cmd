@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Фьючерс Дневник

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :eof
)

rem Запасной вариант: Node.js из окружения DeepSeek Harness
set "DSH_NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if exist "%DSH_NODE%" (
  "%DSH_NODE%" server.js
  goto :eof
)

echo Node.js 24+ не найден. Установите Node.js с https://nodejs.org и запустите start.cmd снова.
pause
