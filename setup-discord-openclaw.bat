@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "STATE_DIR=%PROJECT_DIR%.openclaw-state"
set "LOCAL_CONFIG=%STATE_DIR%\openclaw.windows.json"

pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
  echo Failed to access project directory.
  pause
  exit /b 1
)

if not exist "dist\index.js" (
  echo dist\index.js is missing.
  echo Run setup-openclaw.bat first.
  popd
  pause
  exit /b 1
)

if not exist "%LOCAL_CONFIG%" (
  echo Missing config: %LOCAL_CONFIG%
  echo Run setup-openclaw.bat first.
  popd
  pause
  exit /b 1
)

set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%LOCAL_CONFIG%"

echo OpenClaw Discord setup (project-local)
echo Config: %LOCAL_CONFIG%
echo.
echo Tip: set DISCORD_BOT_TOKEN in this shell before running to avoid typing it.
echo.

if defined DISCORD_BOT_TOKEN (
  set "OC_DISCORD_TOKEN=%DISCORD_BOT_TOKEN%"
  echo Using DISCORD_BOT_TOKEN from environment.
) else (
  set /p "OC_DISCORD_TOKEN=Discord Bot Token (leave blank to keep current): "
)

set /p "OC_DISCORD_GUILD_ID=Discord Server ID (optional, for guild allowlist): "
set "OC_DISCORD_USER_ID="
if defined OC_DISCORD_GUILD_ID (
  set /p "OC_DISCORD_USER_ID=Your Discord User ID (optional, recommended): "
)

set "REQUIRE_MENTION=true"
set /p "REQUIRE_MENTION_INPUT=Require @mention in guild channels? [Y/n]: "
if /I "%REQUIRE_MENTION_INPUT%"=="n" set "REQUIRE_MENTION=false"
if /I "%REQUIRE_MENTION_INPUT%"=="no" set "REQUIRE_MENTION=false"

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\configure-discord.ps1" -ConfigPath "%LOCAL_CONFIG%" -RequireMention "%REQUIRE_MENTION%"
if errorlevel 1 (
  echo.
  echo Discord configuration failed.
  popd
  pause
  exit /b 1
)

echo.
echo Verifying channel config...
node dist\index.js channels list --no-usage

echo.
echo Next:
echo 1. Start gateway with start-openclaw.bat
echo 2. DM your Discord bot to get a pairing code
echo 3. Approve with: node dist\index.js pairing approve discord ^<CODE^>
echo.

set "OC_DISCORD_TOKEN="
set "OC_DISCORD_GUILD_ID="
set "OC_DISCORD_USER_ID="

popd
exit /b 0
