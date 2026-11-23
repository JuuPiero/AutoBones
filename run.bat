@echo off
rem ============================================================
rem  AutoBones - run the desktop app (dev mode, hot reload)
rem  Usage:  run.bat            start the app
rem          run.bat --check    only verify the setup, do not start
rem ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul || (echo [ERROR] Node.js not found. Install Node 20+ from https://nodejs.org & exit /b 1)
where cargo >nul 2>nul || (echo [ERROR] Rust not found. Install it from https://rustup.rs & exit /b 1)
where python >nul 2>nul || (echo [ERROR] Python 3.10+ not found. & exit /b 1)

rem --- Python engine (numpy, trimesh, scipy...) ---
if not exist "engine\.venv\Scripts\python.exe" (
  echo [setup] Creating engine\.venv ...
  python -m venv engine\.venv || exit /b 1
  engine\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
  engine\.venv\Scripts\python.exe -m pip install --quiet -r engine\requirements.txt || exit /b 1
)

rem --- Blender (format conversion, skinning, animation baking) ---
pushd engine
.venv\Scripts\python.exe -m autobones check >nul 2>nul
set BLENDER_RC=%errorlevel%
popd
if not "%BLENDER_RC%"=="0" (
  echo [WARN] Blender not found.
  set "BL="
  set /p BL=Enter the full path to blender.exe ^(or press Enter to skip^): 
  if defined BL (
    if exist "!BL!" (
      python -c "import json,sys;json.dump({'blender':sys.argv[1].replace(chr(92),'/')},open('engine/config.json','w'),indent=2)" "!BL!"
      echo [ok] Saved to engine\config.json
    ) else (echo [WARN] File not found: !BL!)
  )
) else (
  echo [ok] Blender found
)

rem --- optional text-to-motion backend ---
if exist "engine\.venv-motion\Scripts\python.exe" (echo [ok] MoMask ^(text to animation^) installed) else (echo [info] Text-to-animation not installed. Run engine\setup_momask.ps1 to enable it.)

rem --- frontend dependencies ---
if not exist "app\node_modules" (
  echo [setup] Installing frontend packages ...
  pushd app
  call npm install || (popd & exit /b 1)
  popd
)

if /i "%~1"=="--check" (echo Setup OK. & exit /b 0)

echo Starting AutoBones (first start compiles Rust, this can take a few minutes) ...
cd app
call npm run tauri dev
endlocal
