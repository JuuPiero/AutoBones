@echo off
rem ============================================================
rem  AutoBones - build the release desktop app
rem  Usage:  build.bat              build app.exe only (fast, offline-friendly)
rem          build.bat installer    also build the Windows installer (downloads WiX/NSIS on first use, needs internet)
rem          build.bat --check      only verify the setup
rem  Output: app\src-tauri\target\release\app.exe  (installer: ...\release\bundle\)
rem  NOTE: the exe still uses the engine\ folder, Python and Blender on THIS machine (see README).
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo [ERROR] Node.js not found. & exit /b 1)
where cargo >nul 2>nul || (echo [ERROR] Rust not found. & exit /b 1)

if not exist "app\node_modules" (
  echo [setup] Installing frontend packages ...
  pushd app
  call npm install || (popd & exit /b 1)
  popd
)

if /i "%~1"=="--check" (echo Setup OK. & exit /b 0)

echo [1/3] Type-checking the frontend ...
pushd app
call npx tsc --noEmit || (echo [ERROR] TypeScript errors. & popd & exit /b 1)

echo [2/3] Building (first build takes several minutes) ...
if /i "%~1"=="installer" (
  call npm run tauri build || (popd & exit /b 1)
) else (
  call npm run tauri build -- --no-bundle || (popd & exit /b 1)
)
popd

echo [3/3] Done.
echo   exe: %~dp0app\src-tauri\target\release\app.exe
if /i "%~1"=="installer" echo   installer: %~dp0app\src-tauri\target\release\bundle\
endlocal
