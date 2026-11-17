@echo off
rem Atajo para scripts\servidores.ps1 (sin depender de la política de ejecución de PowerShell).
rem Uso: scripts\servidores.cmd [estado|iniciar|detener|reiniciar|log] [todos|dev|demo] [-Construir]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidores.ps1" %*
