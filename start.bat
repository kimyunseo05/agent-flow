@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [회원 CMS] 프로젝트 폴더: %CD%

if not exist "node_modules\" (
  echo 의존성 설치 중...
  call npm install
  if errorlevel 1 (
    echo npm install 실패. Node.js LTS 설치 여부를 확인하세요.
    pause
    exit /b 1
  )
)

echo 서버 시작 — 브라우저에서 http://localhost:3000 을 여세요.
echo 종료하려면 이 창에서 Ctrl+C 를 누르세요.
echo.

node server.js
if errorlevel 1 (
  echo 서버 실행 중 오류가 발생했습니다.
  pause
  exit /b 1
)

pause
