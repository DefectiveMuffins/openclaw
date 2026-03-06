@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "GATEWAY_PORT=18789"
set "UI_BUILD_FAILED=0"
set "CONTROL_UI_DISABLED=0"
set "CONTROL_UI_ENABLED_VALUE="
set "SKIP_BUILD=0"
set "STATE_DIR=%PROJECT_DIR%.openclaw-state"
set "LOCAL_CONFIG=%STATE_DIR%\openclaw.windows.json"
set "USER_CONFIG=%USERPROFILE%\.openclaw\openclaw.json"
set "WSL_UI_DIR=%PROJECT_DIR%..\\openclaw-wsl\\dist\\control-ui"
set "GATEWAY_TOKEN="
set "PNPM_RUNNER=direct"
set "CI=true"

pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
  echo Failed to access project directory.
  pause
  exit /b 1
)

call :preflight_cli
if errorlevel 1 (
  echo Dependencies are incomplete. Attempting offline link repair...
  if exist "scripts\repair-node-modules-links.mjs" (
    node scripts\repair-node-modules-links.mjs
  )
  call :preflight_cli
  if errorlevel 1 (
    echo Offline repair was not enough. Repairing with pnpm install...
    where pnpm.cmd >nul 2>&1
    if errorlevel 1 (
      powershell -NoProfile -Command "pnpm.cmd -v" >nul 2>&1
      if errorlevel 1 (
        echo pnpm is not available in PATH.
        echo Run setup-openclaw.bat to install dependencies, then retry.
        popd
        pause
        exit /b 1
      )
      set "PNPM_RUNNER=powershell"
    )
    call :run_pnpm install
    if errorlevel 1 (
      echo Dependency repair failed.
      echo Run setup-openclaw.bat and try again.
      popd
      pause
      exit /b 1
    )
    call :preflight_cli
    if errorlevel 1 (
      echo Dependencies are still incomplete after repair.
      echo Run setup-openclaw.bat and try again.
      popd
      pause
      exit /b 1
    )
  )
)

if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>&1

if not exist "%LOCAL_CONFIG%" (
  if exist "%USER_CONFIG%" (
    copy /Y "%USER_CONFIG%" "%LOCAL_CONFIG%" >nul
  ) else (
    echo Missing %LOCAL_CONFIG%
    echo Run setup-openclaw.bat first.
    popd
    pause
    exit /b 1
  )
)

set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%LOCAL_CONFIG%"

if /I "%OPENCLAW_SKIP_BUILD%"=="1" set "SKIP_BUILD=1"

if "%SKIP_BUILD%"=="0" (
  echo Building OpenClaw before launch to pick up recent source changes...
  call :run_pnpm build
  if errorlevel 1 (
    echo Build failed.
    echo Set OPENCLAW_SKIP_BUILD=1 to bypass the build temporarily.
    popd
    pause
    exit /b 1
  )
  echo Building Control UI assets before launch...
  call :run_pnpm ui:build
  if errorlevel 1 (
    echo Control UI build failed locally. Falling back to any existing prebuilt assets.
  )
  echo.
) else (
  echo Skipping build because OPENCLAW_SKIP_BUILD=1.
  echo.
)

if exist "scripts\sync-local-models.ps1" (
  echo Syncing local provider models from LM Studio...
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\sync-local-models.ps1" -ConfigPath "%LOCAL_CONFIG%" -ProviderId "local" -QwenOnly -UpdateAgentModels
  if errorlevel 1 (
    echo Warning: model sync failed. Continuing with existing model config.
    echo.
  )
)

for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$cfg='%LOCAL_CONFIG%'; if (Test-Path $cfg) { $j=Get-Content -Raw $cfg | ConvertFrom-Json; $t=$j.gateway.auth.token; if ($t) { $t } }"`) do set "GATEWAY_TOKEN=%%A"

for /f "usebackq delims=" %%A in (`node dist\index.js config get gateway.controlUi.enabled 2^>nul`) do set "CONTROL_UI_ENABLED_VALUE=%%A"
if /I "%CONTROL_UI_ENABLED_VALUE%"=="false" set "CONTROL_UI_DISABLED=1"

if "%CONTROL_UI_DISABLED%"=="0" if not exist "dist\control-ui\index.html" (
  if exist "%WSL_UI_DIR%\\index.html" (
    echo Control UI assets are missing locally.
    echo Copying prebuilt Control UI assets from WSL checkout...
    powershell -NoProfile -Command "if (Test-Path 'dist\\control-ui') { Remove-Item -Recurse -Force 'dist\\control-ui' }; Copy-Item -Recurse -Force '%WSL_UI_DIR%' 'dist\\control-ui'"
    if errorlevel 1 (
      echo Failed to copy prebuilt Control UI assets from %WSL_UI_DIR%.
    )
  )
  if not exist "dist\control-ui\index.html" (
    set "UI_BUILD_FAILED=1"
    set "CONTROL_UI_DISABLED=1"
    echo Control UI assets are missing.
    echo Disabling Control UI in config so gateway can run headless on Windows...
    node dist\index.js config set --strict-json gateway.controlUi.enabled false
    if errorlevel 1 (
      echo Failed to update config automatically.
      echo Run: pnpm.cmd openclaw config set --strict-json gateway.controlUi.enabled false
      popd
      pause
      exit /b 1
    )
  )
)

echo Starting OpenClaw gateway on port %GATEWAY_PORT%...
echo Dashboard: http://127.0.0.1:%GATEWAY_PORT%/
if defined GATEWAY_TOKEN echo Dashboard (tokenized): http://127.0.0.1:%GATEWAY_PORT%/#token=%GATEWAY_TOKEN%
echo Press Ctrl+C to stop.
echo.

if "%UI_BUILD_FAILED%"=="1" (
  echo Control UI is disabled in config for this run.
  echo To re-enable later, set gateway.controlUi.enabled=true in %LOCAL_CONFIG%
  echo.
)

if "%UI_BUILD_FAILED%"=="0" if "%CONTROL_UI_DISABLED%"=="1" (
  echo Control UI is disabled in %LOCAL_CONFIG%.
  echo.
)

node dist\index.js gateway --port %GATEWAY_PORT% --verbose
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Gateway exited with code %EXIT_CODE%.
  pause
)

popd
exit /b %EXIT_CODE%

:run_pnpm
if /I "%PNPM_RUNNER%"=="powershell" (
  powershell -NoProfile -Command "pnpm.cmd %*"
) else (
  pnpm.cmd %*
)
exit /b %ERRORLEVEL%

:preflight_cli
node dist\index.js --version >nul 2>&1
exit /b %ERRORLEVEL%


