@echo off
if exist "..\..\nodejs\npm.cmd" goto :local_nodejs
if exist "..\..\nvm4w\nodejs\npm.cmd" goto :nvm_nodejs

for /f "delims=" %%i in ('where npm.cmd') do (
  if /i not "%%~dpi"=="%~dp0" (
    "%%i" %*
    exit /b %ERRORLEVEL%
  )
)

echo Error: npm.cmd not found.
exit /b 1

:local_nodejs
"..\..\nodejs\npm.cmd" %*
exit /b %ERRORLEVEL%

:nvm_nodejs
"..\..\nvm4w\nodejs\npm.cmd" %*
exit /b %ERRORLEVEL%
