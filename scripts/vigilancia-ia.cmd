@echo off
rem Vigilancia semanal de la IA: programa "npm run vigilar:ia" como tarea de Windows
rem en la maquina del worker (lunes a las 08:00, con la sesion del usuario, que es
rem la que tiene la sesion de Claude). Registro: .servidores\vigilancia-ia.log
rem
rem Uso: scripts\vigilancia-ia.cmd [instalar ^| quitar ^| estado ^| ahora]
setlocal
set "TAREA=Reclutamiento - Vigilancia semanal de la IA"
for %%I in ("%~dp0..") do set "RAIZ=%%~fI"

if /i "%~1"=="instalar" goto instalar
if /i "%~1"=="quitar" goto quitar
if /i "%~1"=="estado" goto estado
if /i "%~1"=="ahora" goto ahora
echo Uso: scripts\vigilancia-ia.cmd [instalar ^| quitar ^| estado ^| ahora]
echo   instalar  programa la medicion semanal (lunes 08:00)
echo   quitar    borra la tarea programada
echo   estado    muestra la tarea y su ultima ejecucion
echo   ahora     mide ya y envia el resultado a la app
exit /b 1

:instalar
schtasks /Create /TN "%TAREA%" /SC WEEKLY /D MON /ST 08:00 /TR "\"%~f0\" ahora" /F
exit /b %errorlevel%

:quitar
schtasks /Delete /TN "%TAREA%" /F
exit /b %errorlevel%

:estado
schtasks /Query /TN "%TAREA%" /V /FO LIST | findstr /i /c:"Nombre de tarea" /c:"TaskName" /c:"Proxima" /c:"Next Run" /c:"Ultimo resultado" /c:"Last Result" /c:"Hora de la ultima" /c:"Last Run"
exit /b %errorlevel%

:ahora
if not exist "%RAIZ%\.servidores" mkdir "%RAIZ%\.servidores"
cd /d "%RAIZ%"
echo ==== %date% %time% ==== >> "%RAIZ%\.servidores\vigilancia-ia.log"
call npm run vigilar:ia >> "%RAIZ%\.servidores\vigilancia-ia.log" 2>&1
exit /b %errorlevel%
