<#
.SYNOPSIS
  Enciende, apaga y muestra los servidores locales de la app, sin dejar ventanas abiertas.

.DESCRIPTION
  - dev  : servidor de desarrollo (next dev)              -> http://localhost:3999
  - demo : build de producción (next start, .next-prod)   -> http://localhost:3100
  - ia   : worker de IA (npm run ia:worker, `claude -p` con la suscripción). No abre puerto:
           consulta la cola de la app indicada en IA_WORKER_APP_URL (.env.ia-worker).
  - portales : portales ficticios del robot para la demo (npm run bot:fake-portal) -> http://127.0.0.1:4010
  - robot    : robot de portales (npm run bot, .env.bot). No abre puerto.

  «arrancar» deja todo listo después de reiniciar la PC: abre Docker Desktop si está cerrado,
  levanta Supabase local y enciende dev, demo, ia, portales y robot (en ese orden).

  «todos» (el valor por defecto) en iniciar, detener y reiniciar son solo dev, demo e ia: el robot
  y los portales se manejan por su nombre (p. ej. «reiniciar robot») o con «arrancar».

  Los servidores corren ocultos, en segundo plano. Su salida va a .servidores\<nombre>.log
  y su número de proceso a .servidores\<nombre>.pid: así se pueden ver y apagar siempre,
  aunque se cierre la terminal desde la que se lanzaron (antes quedaban «huérfanos» y no
  había forma sencilla de encontrarlos).

  Al apagar se busca el servidor por su puerto y se cierra todo su árbol de procesos
  (cmd -> npm -> next), pero solo si es un proceso de Node/npm/Next: nunca toca otra cosa.

.EXAMPLE
  scripts\servidores.cmd                      # estado de los dos
  scripts\servidores.cmd iniciar              # enciende dev y demo
  scripts\servidores.cmd iniciar demo         # solo la demo
  scripts\servidores.cmd detener              # apaga los dos
  scripts\servidores.cmd reiniciar demo -Construir   # apaga la demo, recompila .next-prod y la enciende
  scripts\servidores.cmd log dev              # últimas líneas del registro del servidor de desarrollo
  scripts\servidores.cmd reiniciar ia         # reinicia el worker de IA (p. ej. tras cambiar .env.ia-worker)
  scripts\servidores.cmd arrancar             # tras reiniciar la PC: Docker, Supabase y todos los servicios
#>
param(
  [Parameter(Position = 0)][ValidateSet("iniciar", "detener", "reiniciar", "estado", "log", "arrancar")][string]$Accion = "estado",
  [Parameter(Position = 1)][ValidateSet("todos", "dev", "demo", "ia", "portales", "robot")][string]$Servidor = "todos",
  [switch]$Construir
)

$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $PSScriptRoot
$Dir = Join-Path $Raiz ".servidores"
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir | Out-Null }

$Config = [ordered]@{
  dev  = @{ Puerto = 3999; Comando = "set PORT=3999&& npm run dev"; Nombre = "desarrollo (next dev)" }
  demo = @{ Puerto = 3100; Comando = "set NEXT_DIST_DIR=.next-prod&& npx next start -p 3100"; Nombre = "demo (build de producción, .next-prod)" }
  ia   = @{ Puerto = $null; Comando = "npm run ia:worker"; Nombre = "worker de IA (claude -p)"; Patron = '(?i)ia-worker[\\/]src[\\/]index\.ts'; Env = ".env.ia-worker" }
  portales = @{ Puerto = 4010; Comando = "npm run bot:fake-portal"; Nombre = "portales ficticios del robot (demo)" }
  robot = @{ Puerto = $null; Comando = "npm run bot"; Nombre = "robot de portales"; Patron = '(?i)bot[\\/]src[\\/]index\.ts'; Env = ".env.bot" }
}

# Procesos que forman parte de un servidor de la app: cmd/bash/node que ejecutan npm, npx, next o el worker.
$PatronServidor = '(?i)(\bnext(\.cmd)?\b|start-server\.js|\bnpm(-cli\.js)?\b|\bnpx(-cli\.js)?\b|ia-worker[\\/]src[\\/]index\.ts|bot[\\/]src[\\/](index|fake-portal[\\/]main)\.ts)'

function Get-Proceso([int]$Id) {
  Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction SilentlyContinue
}

function Test-ProcesoServidor($Proceso) {
  return ($null -ne $Proceso) -and ($Proceso.CommandLine -match $PatronServidor)
}

# Sube por los procesos padre mientras sigan siendo parte del servidor (cmd -> npm -> next).
function Get-RaizServidor([int]$Id) {
  $actual = Get-Proceso $Id
  if (-not (Test-ProcesoServidor $actual)) { return $null }
  for ($i = 0; $i -lt 8; $i++) {
    $padre = Get-Proceso $actual.ParentProcessId
    if (-not (Test-ProcesoServidor $padre)) { break }
    $actual = $padre
  }
  return [int]$actual.ProcessId
}

function Get-PidEnPuerto([int]$Puerto) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return $null
}

function Get-Archivo([string]$Nombre, [string]$Extension) { Join-Path $Dir "$Nombre.$Extension" }

# Un proceso del servicio: por su puerto (dev, demo) o por su línea de comandos (worker, sin puerto).
function Get-PidServicio([string]$Nombre) {
  $cfg = $Config[$Nombre]
  if ($cfg.Puerto) { return Get-PidEnPuerto $cfg.Puerto }
  $p = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $cfg.Patron } | Select-Object -First 1
  if ($p) { return [int]$p.ProcessId }
  return $null
}

function Get-UrlWorker {
  $archivo = Join-Path $Raiz ".env.ia-worker"
  if (-not (Test-Path $archivo)) { return "(sin .env.ia-worker)" }
  $linea = Get-Content $archivo | Where-Object { $_ -match '^IA_WORKER_APP_URL=' } | Select-Object -First 1
  if ($linea) { return ($linea -split '=', 2)[1].Trim() }
  return "(sin IA_WORKER_APP_URL)"
}

function Show-Estado([string]$Nombre) {
  $cfg = $Config[$Nombre]
  if (-not $cfg.Puerto) {
    $id = Get-PidServicio $Nombre
    $destino = if ($Nombre -eq "ia") { "-> $(Get-UrlWorker)" } else { "" }
    if ($id) { Write-Host ("  {0,-8} ENCENDIDO  {1}  (PID {2})  {3}" -f $Nombre, $destino, $id, $cfg.Nombre) -ForegroundColor Green }
    else { Write-Host ("  {0,-8} apagado    {1}" -f $Nombre, $cfg.Nombre) -ForegroundColor DarkGray }
    return
  }
  $id = Get-PidEnPuerto $cfg.Puerto
  if ($id) {
    Write-Host ("  {0,-8} ENCENDIDO  http://localhost:{1}  (PID {2})  {3}" -f $Nombre, $cfg.Puerto, $id, $cfg.Nombre) -ForegroundColor Green
  } else {
    Write-Host ("  {0,-8} apagado    puerto {1}  {2}" -f $Nombre, $cfg.Puerto, $cfg.Nombre) -ForegroundColor DarkGray
  }
}

function Stop-Servidor([string]$Nombre) {
  $cfg = $Config[$Nombre]
  $raices = @()
  $pidFile = Get-Archivo $Nombre "pid"
  if (Test-Path $pidFile) {
    $guardado = [int](Get-Content $pidFile -Raw)
    if (Test-ProcesoServidor (Get-Proceso $guardado)) { $raices += $guardado }
  }
  $activo = Get-PidServicio $Nombre
  if ($activo) {
    $raiz = Get-RaizServidor $activo
    if ($raiz) { $raices += $raiz }
    else { Write-Host "  ${Nombre}: el puerto $($cfg.Puerto) lo usa otro programa (PID $activo), no un servidor de la app: no lo toco." -ForegroundColor Yellow }
  }
  $raices = $raices | Select-Object -Unique
  if ($raices.Count -eq 0) { Write-Host "  ${Nombre}: ya estaba apagado."; Remove-Item $pidFile -ErrorAction SilentlyContinue; return }
  foreach ($r in $raices) { & taskkill.exe /PID $r /T /F 2>$null | Out-Null }
  for ($i = 0; $i -lt 20 -and (Get-PidServicio $Nombre); $i++) { Start-Sleep -Milliseconds 500 }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  if (Get-PidServicio $Nombre) {
    if ($cfg.Puerto) { Write-Host "  ${Nombre}: no se pudo liberar el puerto $($cfg.Puerto)." -ForegroundColor Red }
    else { Write-Host "  ${Nombre}: no se pudo detener." -ForegroundColor Red }
  }
  else { Write-Host "  ${Nombre}: apagado." }
}

function Build-Demo {
  if (Get-PidEnPuerto $Config.demo.Puerto) {
    throw "La demo está encendida y usa .next-prod: apáguela antes de recompilar (use 'reiniciar demo -Construir')."
  }
  Write-Host "  demo: compilando .next-prod (tarda 1-2 minutos)..."
  $log = Get-Archivo "build" "log"
  $p = Start-Process cmd.exe -ArgumentList "/c", "set NEXT_DIST_DIR=.next-prod&& npm run build > `"$log`" 2>&1" -WorkingDirectory $Raiz -WindowStyle Hidden -PassThru -Wait
  if ($p.ExitCode -ne 0) { throw "La compilación falló (código $($p.ExitCode)). Revise $log" }
  Write-Host "  demo: compilación lista."
}

# Servicios sin puerto (worker de IA, robot): se dan por listos si siguen vivos tras unos segundos.
function Start-SinPuerto([string]$Nombre) {
  $cfg = $Config[$Nombre]
  $ocupado = Get-PidServicio $Nombre
  if ($ocupado) { Write-Host "  ${Nombre}: ya estaba encendido (PID $ocupado)."; return }
  if ($cfg.Env -and -not (Test-Path (Join-Path $Raiz $cfg.Env))) { throw "Falta $($cfg.Env) para ${Nombre}." }
  $log = Get-Archivo $Nombre "log"
  $p = Start-Process cmd.exe -ArgumentList "/c", "$($cfg.Comando) >> `"$log`" 2>&1" -WorkingDirectory $Raiz -WindowStyle Hidden -PassThru
  Set-Content -Path (Get-Archivo $Nombre "pid") -Value $p.Id
  Write-Host -NoNewline "  ${Nombre}: arrancando"
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 1
    if ($p.HasExited) { break }
    Write-Host -NoNewline "."
  }
  if (-not $p.HasExited -and (Get-PidServicio $Nombre)) {
    $extra = if ($Nombre -eq "ia") { ", consultando $(Get-UrlWorker)" } else { "" }
    Write-Host " -> en marcha$extra" -ForegroundColor Green
    return
  }
  Write-Host ""
  Write-Host "  ${Nombre}: no arrancó. Últimas líneas de $log :" -ForegroundColor Red
  if (Test-Path $log) { Get-Content $log -Tail 15 }
}

# Tras reiniciar la PC: Docker Desktop (si está cerrado) y Supabase local.
function Start-Base {
  & cmd.exe /c "docker info >nul 2>&1"
  if ($LASTEXITCODE -ne 0) {
    $exe = @(
      (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
      (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) { throw "Docker no responde y no encuentro Docker Desktop: ábralo a mano." }
    Start-Process $exe
    Write-Host -NoNewline "  docker: abriendo Docker Desktop"
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 3
      & cmd.exe /c "docker info >nul 2>&1"
      if ($LASTEXITCODE -eq 0) { break }
      Write-Host -NoNewline "."
    }
    if ($LASTEXITCODE -ne 0) { throw "Docker no respondió en 3 minutos." }
    Write-Host " -> listo" -ForegroundColor Green
  } else { Write-Host "  docker: ya estaba encendido." }
  Write-Host "  supabase: levantando la base local (si ya estaba, no cambia nada)..."
  Push-Location $Raiz
  # Por cmd: las advertencias de Supabase en stderr no deben cortar el script (PowerShell 5.1 las trata como error).
  try { & cmd.exe /c "npx supabase start > `"$(Get-Archivo "supabase" "log")`" 2>&1" } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Supabase no arrancó. Revise $(Get-Archivo "supabase" "log")" }
  Write-Host "  supabase: listo." -ForegroundColor Green
}

function Start-Servidor([string]$Nombre) {
  if (-not $Config[$Nombre].Puerto) { Start-SinPuerto $Nombre; return }
  $cfg = $Config[$Nombre]
  $ocupado = Get-PidEnPuerto $cfg.Puerto
  if ($ocupado) {
    if ($Construir -and $Nombre -eq "demo") { throw "La demo ya está encendida: use 'reiniciar demo -Construir' para recompilarla." }
    Write-Host "  ${Nombre}: ya estaba encendido en http://localhost:$($cfg.Puerto) (PID $ocupado)."
    return
  }
  if ($Nombre -eq "demo") {
    if ($Construir) { Build-Demo }
    if (-not (Test-Path (Join-Path $Raiz ".next-prod\BUILD_ID"))) { throw "No hay build de la demo en .next-prod: use 'iniciar demo -Construir'." }
  }
  $log = Get-Archivo $Nombre "log"
  $p = Start-Process cmd.exe -ArgumentList "/c", "$($cfg.Comando) > `"$log`" 2>&1" -WorkingDirectory $Raiz -WindowStyle Hidden -PassThru
  Set-Content -Path (Get-Archivo $Nombre "pid") -Value $p.Id
  Write-Host -NoNewline "  ${Nombre}: arrancando"
  for ($i = 0; $i -lt 90; $i++) {
    if (Get-PidEnPuerto $cfg.Puerto) { Write-Host " -> listo en http://localhost:$($cfg.Puerto)" -ForegroundColor Green; return }
    if ($p.HasExited) { break }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 1
  }
  Write-Host ""
  Write-Host "  ${Nombre}: no arrancó. Últimas líneas de $log :" -ForegroundColor Red
  if (Test-Path $log) { Get-Content $log -Tail 15 }
}

# «todos» en iniciar/detener/reiniciar son solo los de la app (dev, demo, ia), como antes: el robot
# publica en portales y no debe reiniciarse de rebote. Robot y portales van por nombre o con «arrancar».
$nombres = if ($Servidor -ne "todos") { @($Servidor) }
  elseif ($Accion -in @("estado", "log", "arrancar")) { @($Config.Keys) }
  else { @("dev", "demo", "ia") }
switch ($Accion) {
  "estado"    { foreach ($n in $nombres) { Show-Estado $n } }
  "detener"   { foreach ($n in $nombres) { Stop-Servidor $n } }
  "iniciar"   { foreach ($n in $nombres) { Start-Servidor $n } }
  "reiniciar" { foreach ($n in $nombres) { Stop-Servidor $n; Start-Servidor $n } }
  "arrancar"  { Start-Base; foreach ($n in $nombres) { Start-Servidor $n } }
  "log" {
    foreach ($n in $nombres) {
      $log = Get-Archivo $n "log"
      Write-Host "== $n ($log)"
      if (Test-Path $log) { Get-Content $log -Tail 40 } else { Write-Host "  (sin registro todavía)" }
    }
  }
}
