@echo off
setlocal EnableExtensions

set "PROJECT_DIR=%~dp0"
set "STATE_DIR=%PROJECT_DIR%.openclaw-state"
set "CONFIG_PATH=%STATE_DIR%\openclaw.windows.json"

if "%~1"=="" (
  >&2 echo RESULT status=error code=missing_agent_id usage="create-openclaw-agent-noninteractive.bat ^<agent_id^> [workspace] [model]"
  exit /b 2
)

set "AGENT_ID=%~1"
set "WORKSPACE_DIR=%~2"
if "%WORKSPACE_DIR%"=="" set "WORKSPACE_DIR=%PROJECT_DIR%workspace\agents\%AGENT_ID%"
set "MODEL_ID=%~3"

if not exist "%PROJECT_DIR%dist\index.js" (
  >&2 echo RESULT status=error code=missing_dist_index path="%PROJECT_DIR%dist\index.js"
  exit /b 3
)

if not exist "%CONFIG_PATH%" (
  >&2 echo RESULT status=error code=missing_config path="%CONFIG_PATH%"
  exit /b 4
)

set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%CONFIG_PATH%"

if "%MODEL_ID%"=="" (
  node "%PROJECT_DIR%dist\index.js" agents add "%AGENT_ID%" --workspace "%WORKSPACE_DIR%" --non-interactive --json
) else (
  node "%PROJECT_DIR%dist\index.js" agents add "%AGENT_ID%" --workspace "%WORKSPACE_DIR%" --model "%MODEL_ID%" --non-interactive --json
)

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  >&2 echo RESULT status=error code=agents_add_failed agentId="%AGENT_ID%" exitCode=%EXIT_CODE%
  exit /b %EXIT_CODE%
)

set "MODEL_OUT=%MODEL_ID%"
if "%MODEL_OUT%"=="" set "MODEL_OUT=(default)"
echo RESULT status=ok agentId="%AGENT_ID%" model="%MODEL_OUT%" workspace="%WORKSPACE_DIR%" config="%CONFIG_PATH%"
exit /b 0
