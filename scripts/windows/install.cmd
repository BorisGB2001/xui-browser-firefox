@echo off
rem Установка помощника XUI Browser Client (Windows)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
