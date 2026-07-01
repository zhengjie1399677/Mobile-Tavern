@echo off
if exist "..\..\nodejs\npx.cmd" goto :local_nodejs
if exist "..\..\nvm4w\nodejs\npx.cmd" goto :nvm_nodejs

for /f "delims=" %%i in ('where npx.cmd') do (
  if /i not "%%~dpi"=="%~dp0" (
    "%%i" %*
    exit /b %ERRORLEVEL%
  )
)

echo Error: npx.cmd not found.
exit /b 1

:local_nodejs
"..\..\nodejs\npx.cmd" %*
exit /b %ERRORLEVEL%

:nvm_nodejs
"..\..\nvm4w\nodejs\npx.cmd" %*
exit /b %ERRORLEVEL%
