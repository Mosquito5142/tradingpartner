@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PYEXE=python
where python >nul 2>nul
if errorlevel 1 set PYEXE=py

"%PYEXE%" gold_news.py %*

if errorlevel 1 (
  echo.
  echo [ERROR] Something went wrong. Read the message above.
  pause
)
