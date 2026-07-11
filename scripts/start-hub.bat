@echo off
REM Claude Code Hub launcher — double-click this to start the hub on port 5757.
REM If it crashes or fails to start, the window stays open and shows a plain-
REM English summary instead of vanishing the instant Node exits.
setlocal
title Claude Code Hub

REM Resolve repo root as the parent of this scripts\ folder, regardless of
REM where the shortcut/double-click launches from.
cd /d "%~dp0.."

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

set "PORT=5757"
if not "%~1"=="" set "PORT=%~1"

echo ============================================================
echo   Claude Code Hub
echo   Starting on http://127.0.0.1:%PORT%
echo   Close this window to stop the server.
echo ============================================================
echo.

"%NODE_EXE%" claude-dashboard\server.js %PORT%
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo ------------------------------------------------------------
    echo   Hub stopped normally.
    echo ------------------------------------------------------------
) else (
    echo ============================================================
    echo   THE HUB STOPPED WITH AN ERROR  (exit code %EXITCODE%)
    echo ------------------------------------------------------------
    echo   Scroll up ^^ — the actual error/stack trace from Node is
    echo   printed above this box. Common causes:
    echo     - Port %PORT% already in use  (another hub is running —
    echo       close it, or run:  start-hub.bat 5758)
    echo     - node.exe not found  (edit NODE_EXE at the top of this
    echo       file if Node isn't installed at the default path)
    echo     - A syntax/runtime error in server.js or lib\*.js after
    echo       an edit — the stack trace above names the file+line.
    echo ============================================================
)
echo.
pause
endlocal
