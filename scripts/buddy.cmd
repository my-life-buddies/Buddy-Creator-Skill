@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo {"ok":false,"error":{"code":"NODE_REQUIRED","message":"Buddy requires Node.js 22.13 or later."}}
  exit /b 1
)
node "%~dp0buddy.mjs" %*
exit /b %errorlevel%
