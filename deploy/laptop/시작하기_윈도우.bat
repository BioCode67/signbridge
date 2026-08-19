@echo off
chcp 65001 > nul
title SignBridge
echo.
echo   SignBridge 를 시작합니다...
echo   (이 창을 닫으면 사이트도 닫힙니다)
echo.
cd /d "%~dp0"
where python > nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:8000
  python -m http.server 8000
  goto :eof
)
where py > nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:8000
  py -m http.server 8000
  goto :eof
)
echo   [!] 파이썬이 없습니다.
echo       https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요.
echo       설치할 때 "Add Python to PATH" 를 꼭 체크하세요.
pause
