@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "WORKSPACE_DIR=%PROJECT_DIR%workspace"
set "UI_BUILD_FAILED=0"
set "UI_ASSETS_RECOVERED=0"
set "STATE_DIR=%PROJECT_DIR%.openclaw-state"
set "LOCAL_CONFIG=%STATE_DIR%\openclaw.windows.json"
set "WSL_UI_DIR=%PROJECT_DIR%..\\openclaw-wsl\\dist\\control-ui"
set "PNPM_RUNNER=direct"
set "CI=true"

echo OpenClaw Windows setup
echo Project: %PROJECT_DIR%
echo.

pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
  echo Failed to access project directory.
  pause
  exit /b 1
)

if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>&1
set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%LOCAL_CONFIG%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not available in PATH.
  echo Install Node 22+ and rerun this setup.
  popd
  pause
  exit /b 1
)

where pnpm.cmd >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "pnpm.cmd -v" >nul 2>&1
  if errorlevel 1 (
    echo pnpm is not available in PATH.
    echo Install with: npm.cmd install -g pnpm, then rerun setup.
    popd
    pause
    exit /b 1
  )
  set "PNPM_RUNNER=powershell"
)

echo [1/4] Installing dependencies...
call :run_pnpm install
if errorlevel 1 goto :fail

echo [2/4] Building OpenClaw...
call :run_pnpm build
if errorlevel 1 goto :fail

echo [3/4] Building Control UI...
call :run_pnpm ui:build
if errorlevel 1 (
  echo.
  echo Control UI build failed ^(commonly Error: spawn EPERM on native Windows^).
  if exist "%WSL_UI_DIR%\\index.html" (
    echo Copying prebuilt Control UI assets from WSL checkout...
    powershell -NoProfile -Command "if (Test-Path 'dist\\control-ui') { Remove-Item -Recurse -Force 'dist\\control-ui' }; Copy-Item -Recurse -Force '%WSL_UI_DIR%' 'dist\\control-ui'"
    if not errorlevel 1 (
      set "UI_ASSETS_RECOVERED=1"
      echo Control UI assets recovered from WSL checkout.
    )
  )
  if "%UI_ASSETS_RECOVERED%"=="0" (
    set "UI_BUILD_FAILED=1"
    echo Continuing setup with Control UI disabled.
  )
)

echo [4/4] Initializing config and workspace...
call :run_pnpm openclaw onboard --non-interactive --accept-risk --mode local --auth-choice skip --workspace "%WORKSPACE_DIR%" --gateway-port 18789 --gateway-bind loopback --no-install-daemon --skip-channels --skip-skills --skip-ui --skip-health
if errorlevel 1 goto :fail

if "%UI_BUILD_FAILED%"=="1" (
  call node dist\index.js config set --strict-json gateway.controlUi.enabled false
  if errorlevel 1 goto :fail
)

echo.
echo Setup complete.
echo Next: run start-openclaw.bat
echo Config: %LOCAL_CONFIG%
if "%UI_ASSETS_RECOVERED%"=="1" (
  echo Control UI assets were copied from %WSL_UI_DIR%.
)
if "%UI_BUILD_FAILED%"=="1" (
  echo Note: Control UI was disabled because UI build failed on this Windows environment.
  echo To re-enable later, set gateway.controlUi.enabled=true in %LOCAL_CONFIG%
)
popd
exit /b 0

:run_pnpm
if /I "%PNPM_RUNNER%"=="powershell" (
  powershell -NoProfile -Command "pnpm.cmd %*"
) else (
  pnpm.cmd %*
)
exit /b %ERRORLEVEL%

:fail
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Setup failed with exit code %EXIT_CODE%.
popd
pause
exit /b %EXIT_CODE%
