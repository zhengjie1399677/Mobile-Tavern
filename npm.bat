@echo off
if exist "D:\nodejs\npm.cmd" (
  "D:\nodejs\npm.cmd" %*
) else if exist "D:\nvm4w\nodejs\npm.cmd" (
  "D:\nvm4w\nodejs\npm.cmd" %*
) else if exist "C:\Program Files\nodejs\npm.cmd" (
  "C:\Program Files\nodejs\npm.cmd" %*
) else if exist "%APPDATA%\npm\npm.cmd" (
  "%APPDATA%\npm\npm.cmd" %*
) else (
  echo Error: npm.cmd not found in common locations.
  exit /b 1
)
