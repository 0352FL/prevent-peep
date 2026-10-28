@echo off
setlocal
title Prevent-peep - Big Fat Fish Security Assistant
set "PS1=%~dp0tools\manage.ps1"
if not exist "%PS1%" (
  echo [Prevent-peep] missing script: %PS1%
  pause
  exit /b 1
)
echo Starting Prevent-peep window...
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%PS1%"
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo [Prevent-peep] exited with code %CODE%.
  pause
)
