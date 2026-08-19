@echo off
chcp 65001 > nul
title SignBridge
cd /d "%~dp0"
echo.
echo   SignBridge 를 시작합니다...
echo.

rem ── 파이썬이 "있는지"가 아니라 "되는지"를 본다.
rem    윈도우 11에는 Microsoft Store 로 연결되는 **가짜 python.exe** 가 있어서
rem    where 로는 찾아지지만 실행하면 즉시 끝난다. 그래서 창이 바로 사라졌다.
python -c "import sys" > nul 2>&1
if %errorlevel%==0 (
  echo   [파이썬으로 시작합니다]
  echo   브라우저가 안 열리면 주소창에 직접:  http://localhost:8000
  echo   (이 창을 닫으면 사이트도 닫힙니다)
  echo.
  start "" http://localhost:8000
  python -m http.server 8000
  goto :end
)

py -c "import sys" > nul 2>&1
if %errorlevel%==0 (
  echo   [파이썬으로 시작합니다]
  echo   브라우저가 안 열리면 주소창에 직접:  http://localhost:8000
  echo   (이 창을 닫으면 사이트도 닫힙니다)
  echo.
  start "" http://localhost:8000
  py -m http.server 8000
  goto :end
)

rem ── 파이썬이 없거나 가짜다. PowerShell 로 간다 — 윈도우에 기본으로 있다.
echo   [파이썬이 없어 PowerShell 로 시작합니다]
echo   브라우저가 안 열리면 주소창에 직접:  http://localhost:8000
echo   (이 창을 닫으면 사이트도 닫힙니다)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0서버.ps1"

:end
echo.
echo   ────────────────────────────────────────────
echo   서버가 멈췄습니다.
echo   위에 빨간 글씨나 오류가 있으면 그대로 알려 주세요.
echo   ────────────────────────────────────────────
echo.
pause
