@echo off
if exist "D:\nodejs\npx.cmd" (
  "D:\nodejs\npx.cmd" %*
) else if exist "D:\nvm4w\nodejs\npx.cmd" (
  "D:\nvm4w\nodejs\npx.cmd" %*
) else if exist "C:\Program Files\nodejs\npx.cmd" (
  "C:\Program Files\nodejs\npx.cmd" %*
) else if exist "%APPDATA%\npm\npx.cmd" (
  "%APPDATA%\npm\npx.cmd" %*
) else (
  echo Error: npx.cmd not found in common locations.
  exit /b 1
)
