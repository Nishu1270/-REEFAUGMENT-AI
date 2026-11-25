# ReefAugment AI - Local Windows Startup Script
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPython = Join-Path $RootDir "backend\.venv\Scripts\python.exe"
$FrontendModules = Join-Path $RootDir "frontend\node_modules"

if (-not (Test-Path $BackendPython)) {
    Write-Host "[ERROR] Backend virtual environment not found at: $BackendPython" -ForegroundColor Red
    Write-Host "Please create it and install backend requirements first (see README.md)." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $FrontendModules)) {
    Write-Host "[ERROR] Frontend node_modules not found at: $FrontendModules" -ForegroundColor Red
    Write-Host "Run 'npm install' inside the frontend folder first (see README.md)." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting ReefAugment AI Backend (http://127.0.0.1:8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootDir\backend'; & '.\.venv\Scripts\python.exe' -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

Write-Host "Starting ReefAugment AI Frontend (http://localhost:5173/-REEFAUGMENT-AI/)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootDir\frontend'; npm run dev"

Write-Host ""
Write-Host "ReefAugment AI is launching in two terminal windows:" -ForegroundColor Green
Write-Host "  Frontend App : http://localhost:5173/-REEFAUGMENT-AI/"
Write-Host "  Backend API  : http://127.0.0.1:8000"
Write-Host "  Swagger Docs : http://127.0.0.1:8000/docs"
