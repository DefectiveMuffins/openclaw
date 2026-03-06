@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "STATE_DIR=%PROJECT_DIR%.openclaw-state"
set "CONFIG_PATH=%STATE_DIR%\openclaw.windows.json"

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

if not exist "%CONFIG_PATH%" (
  echo Missing config: %CONFIG_PATH%
  echo Run setup-openclaw.bat first.
  popd
  pause
  exit /b 1
)

set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%CONFIG_PATH%"

echo Add OpenClaw Agent
echo Config: %CONFIG_PATH%
echo.

set "AGENT_NAME="
set /p "AGENT_NAME=Agent name/id: "
if "%AGENT_NAME%"=="" (
  echo Agent name is required.
  popd
  pause
  exit /b 1
)

set "WORKSPACE_DIR=%PROJECT_DIR%workspace\%AGENT_NAME%"
set "WORKSPACE_INPUT="
set /p "WORKSPACE_INPUT=Workspace path (Enter for default: %WORKSPACE_DIR%): "
if not "%WORKSPACE_INPUT%"=="" set "WORKSPACE_DIR=%WORKSPACE_INPUT%"

set "MODEL_ID="
set /p "MODEL_ID=Model id (optional, press Enter to skip): "

if "%MODEL_ID%"=="" (
  node dist\index.js agents add "%AGENT_NAME%" --workspace "%WORKSPACE_DIR%" --non-interactive
) else (
  node dist\index.js agents add "%AGENT_NAME%" --workspace "%WORKSPACE_DIR%" --model "%MODEL_ID%" --non-interactive
)

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Failed to add agent. Exit code %EXIT_CODE%.
  popd
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Agent added successfully.
echo Refresh the Agents tab in Control UI.
popd
pause
exit /b 0

