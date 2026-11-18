<#
.SYNOPSIS
  Enciende, apaga y muestra los servidores locales de la app, sin dejar ventanas abiertas.

.DESCRIPTION
  - dev  : servidor de desarrollo (next dev)              -> http://localhost:3999
  - demo : build de producción (next start, .next-prod)   -> http://localhost:3100
  - ia   : worker de IA (npm run ia:worker, `claude -p` con la suscripción). No abre puerto:
           consulta la cola de la app indicada en IA_WORKER_APP_URL (.env.ia-worker).

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
#>
param(
  [Parameter(Position = 0)][ValidateSet("iniciar", "detener", "reiniciar", "estado", "log")][string]$Accion = "estado",
  [Parameter(Position = 1)][ValidateSet("todos", "dev", "demo", "ia")][string]$Servidor = "todos",
  [switch]$Construir
)

$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $PSScriptRoot
$Dir = Join-Path $Raiz ".servidores"
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir | Out-Null }

$Config = [ordered]@{
  dev  = @{ Puerto = 3999; Comando = "set PORT=3999&& npm run dev"; Nombre = "desarrollo (next dev)" }
  demo = @{ Puerto = 3100; Comando = "set NEXT_DIST_DIR=.next-prod&& npx next start -p 3100"; Nombre = "demo (build de producción, .next-prod)" }
  ia   = @{ Puerto = $null; Comando = "npm run ia:worker"; Nombre = "worker de IA (claude -p)"; Patron = '(?i)ia-worker[\\/]src[\\/]index\.ts' }
}

# Procesos que forman parte de un servidor de la app: cmd/bash/node que ejecutan npm, npx, next o el worker.
$PatronServidor = '(?i)(\bnext(\.cmd)?\b|start-server\.js|\bnpm(-cli\.js)?\b|\bnpx(-cli\.js)?\b|ia-worker[\\/]src[\\/]index\.ts)'

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
    if ($id) { Write-Host ("  {0,-5} ENCENDIDO  -> {1}  (PID {2})  {3}" -f $Nombre, (Get-UrlWorker), $id, $cfg.Nombre) -ForegroundColor Green }
    else { Write-Host ("  {0,-5} apagado    {1}" -f $Nombre, $cfg.Nombre) -ForegroundColor DarkGray }
    return
  }
  $id = Get-PidEnPuerto $cfg.Puerto
  if ($id) {
    Write-Host ("  {0,-5} ENCENDIDO  http://localhost:{1}  (PID {2})  {3}" -f $Nombre, $cfg.Puerto, $id, $cfg.Nombre) -ForegroundColor Green
  } else {
    Write-Host ("  {0,-5} apagado    puerto {1}  {2}" -f $Nombre, $cfg.Puerto, $cfg.Nombre) -ForegroundColor DarkGray
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

function Start-Worker {
  $cfg = $Config.ia
  $ocupado = Get-PidServicio "ia"
  if ($ocupado) { Write-Host "  ia: ya estaba encendido (PID $ocupado) -> $(Get-UrlWorker)."; return }
  if (-not (Test-Path (Join-Path $Raiz ".env.ia-worker"))) { throw "Falta .env.ia-worker (copie ia-worker\env.example y complételo)." }
  $log = Get-Archivo "ia" "log"
  $p = Start-Process cmd.exe -ArgumentList "/c", "$($cfg.Comando) > `"$log`" 2>&1" -WorkingDirectory $Raiz -WindowStyle Hidden -PassThru
  Set-Content -Path (Get-Archivo "ia" "pid") -Value $p.Id
  Write-Host -NoNewline "  ia: arrancando"
  # El worker no abre puerto: se da por listo si sigue vivo tras unos segundos (la config se valida al arrancar).
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 1
    if ($p.HasExited) { break }
    Write-Host -NoNewline "."
  }
  if (-not $p.HasExited -and (Get-PidServicio "ia")) {
    Write-Host " -> en marcha, consultando $(Get-UrlWorker)" -ForegroundColor Green
    return
  }
  Write-Host ""
  Write-Host "  ia: no arrancó. Últimas líneas de $log :" -ForegroundColor Red
  if (Test-Path $log) { Get-Content $log -Tail 15 }
}

function Start-Servidor([string]$Nombre) {
  if ($Nombre -eq "ia") { Start-Worker; return }
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

$nombres = if ($Servidor -eq "todos") { @($Config.Keys) } else { @($Servidor) }
switch ($Accion) {
  "estado"    { foreach ($n in $nombres) { Show-Estado $n } }
  "detener"   { foreach ($n in $nombres) { Stop-Servidor $n } }
  "iniciar"   { foreach ($n in $nombres) { Start-Servidor $n } }
  "reiniciar" { foreach ($n in $nombres) { Stop-Servidor $n; Start-Servidor $n } }
  "log" {
    foreach ($n in $nombres) {
      $log = Get-Archivo $n "log"
      Write-Host "== $n ($log)"
      if (Test-Path $log) { Get-Content $log -Tail 40 } else { Write-Host "  (sin registro todavía)" }
    }
  }
}
