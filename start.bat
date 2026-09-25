@echo off
chcp 65001 >nul
title Farm Steam Points - TF2
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ============================================================
  echo   Не найден Node.js - без него программа не запустится.
  echo.
  echo   1. Сейчас откроется сайт nodejs.org
  echo   2. Скачайте версию LTS и установите ^(везде жмите Next^)
  echo   3. Закройте это окно и снова запустите start.bat
  echo  ============================================================
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo  Первый запуск: устанавливаю нужные файлы, это 1-2 минуты...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Не удалось установить файлы. Проверьте интернет и запустите start.bat ещё раз.
    pause
    exit /b 1
  )
)

node src\index.js
echo.
pause
