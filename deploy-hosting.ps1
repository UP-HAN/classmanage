# Firebase Hosting 배포 (로그인은 한 번만: 터미널에서 firebase login 실행)
# 사용법: PowerShell에서 이 폴더로 이동 후 .\deploy-hosting.ps1

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
    Write-Host "firebase CLI가 없습니다. 먼저 실행: npm install -g firebase-tools" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath ".firebaserc")) {
    Write-Host ".firebaserc가 없습니다. 다음 중 하나를 하세요:" -ForegroundColor Yellow
    Write-Host "  1) firebase use --add  로 프로젝트 선택" -ForegroundColor Yellow
    Write-Host "  2) .firebaserc.example 을 복사해 프로젝트 ID를 넣기" -ForegroundColor Yellow
    exit 1
}

firebase deploy --only hosting
