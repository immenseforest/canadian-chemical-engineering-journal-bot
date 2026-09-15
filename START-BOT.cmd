@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 LTS or newer from https://nodejs.org then reopen this file.
  pause
  exit /b 1
)
if not exist node_modules\discord.js (
  call npm ci --omit=dev --ignore-scripts
  if errorlevel 1 exit /b 1
)
node -e "const fs=require('fs');if(fs.existsSync('.env'))process.loadEnvFile('.env');process.exit(process.env.DISCORD_BOT_TOKEN?0:1)"
if errorlevel 1 (
  echo Open the Setup URL printed below to enter your Discord bot token.
  node scripts/setup-bot.mjs
  if errorlevel 1 exit /b 1
)
node src/service.mjs
pause
