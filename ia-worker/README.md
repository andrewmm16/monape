# Worker de evaluaciones con IA (`ia-worker/`)

Procesa la cola de evaluaciones con IA usando el **CLI oficial de Claude Code** (`claude -p`) con la
**suscripción de Claude** (OAuth, sin API de pago). Diseño: [`docs/superpowers/specs/2026-11-16-ia-cola-oauth-design.md`](../docs/superpowers/specs/2026-11-16-ia-cola-oauth-design.md).

```
Vercel (app) ──► Supabase: ai_evaluation_jobs (cola, RLS, auditoría)
     ▲                      │
     │ resultado            ▼ reclamo (cada IA_WORKER_POLL_SECONDS si no hay trabajo)
     └──────── ia-worker (máquina siempre encendida) ── claude -p (CLAUDE_CODE_OAUTH_TOKEN)
```

- **Solo transporta.** Recibe de la app el prompt ya armado (CV con datos de contacto reemplazados +
  requisitos) y devuelve la salida del modelo. La app valida las citas contra el CV, aplica las
  verificaciones de RRHH, calcula la puntuación y registra la evaluación.
- **No tiene acceso a la base de datos** ni a la clave de servicio: solo a `/api/ia/trabajos/*` con
  `Authorization: Bearer <IA_WORKER_SECRET>`.
- **Sin tope de análisis.** El único freno es el límite del plan de Claude (ventanas de 5 horas y
  semanales). Al alcanzarlo, el worker se pausa hasta la renovación (o 15 min si no la conoce), la
  cola espera sin gastar intentos y la página de la postulación muestra «en espera».
- El consumo comparte el límite con su uso personal de Claude Code. Si la app consume la ventana,
  también usted espera.

## Puesta en marcha

### 1. En la app (Vercel → Settings → Environment Variables, entorno *Production*)

| Variable | Valor |
|---|---|
| `AI_PROVIDER` | `claude-cli` |
| `AI_EXTERNAL_PROCESSING_APPROVED` | `true` (la empresa aprueba enviar CV al proveedor) |
| `AI_WORKER_SECRET` | 32 caracteres o más, aleatorio (*Sensitive*). Genérelo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AI_MODEL` | Opcional. Por defecto `claude-haiku-5-5` (suficiente para leer el CV y confirmar texto). `claude-sonnet-5-5` o `claude-opus-5-5` dan más finura pero gastan más del plan |
| `AI_AUTO_ENQUEUE` | Opcional: `dudosos` (por defecto), `todos` u `off` |

Vuelva a desplegar para que tomen efecto.

### 2. El token de Claude

En una PC donde ya usa Claude Code:

```bash
claude setup-token
```

Copie el token (`sk-ant-oat01-…`): es su credencial, guárdelo como un secreto. Dura alrededor de un
año: **agende un recordatorio** para renovarlo. Si caduca, el worker se pausa, lo dice en su log y la
app muestra «el servicio de IA perdió su sesión».

En la cuenta de Claude, revise **Configuración → Privacidad** y desactive el uso de sus chats para
entrenar modelos: por aquí pasan CV de personas reales.

### 3. La máquina del worker

Necesita estar siempre encendida, con Node.js 22.12 o superior y salida a internet. No necesita
puertos abiertos: solo hace solicitudes salientes a la app y a Anthropic.

**Opción recomendada: VM gratuita (Oracle Cloud Always Free, Ubuntu)**

```bash
# Node 22 y Claude Code
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g @anthropic-ai/claude-code

# Código (solo se usa ia-worker/, pero comparte dependencias con el repo)
git clone <url-del-repo> ~/reclutamiento && cd ~/reclutamiento && npm ci

# Configuración
cp ia-worker/env.example .env.ia-worker && nano .env.ia-worker   # URL, secreto y token
chmod 600 .env.ia-worker
npm run ia:worker   # prueba manual: debe decir «atendiendo https://…»; Ctrl+C para salir
```

Servicio que arranca solo y se reinicia si falla (`/etc/systemd/system/ia-worker.service`):

```ini
[Unit]
Description=Worker de evaluaciones con IA
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/reclutamiento
ExecStart=/usr/bin/npm run ia:worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ia-worker
journalctl -u ia-worker -f   # log
```

**Alternativa: la PC del robot (Windows).** Ya tiene Node y `claude`. Cree `.env.ia-worker` en la
raíz del repo y en el **Programador de tareas** cree una tarea «Al iniciar el sistema» que ejecute
`cmd /c cd /d C:\ruta\al\repo && npm run ia:worker`. En *Configuración*, marque «Si la tarea
no se ejecuta correctamente, reiniciarla cada 1 minuto». Solo sirve si la PC está siempre encendida.

## Variables del worker (`.env.ia-worker`)

| Variable | Por defecto | Descripción |
|---|---|---|
| `IA_WORKER_APP_URL` | — | URL pública de la app |
| `IA_WORKER_SECRET` | — | Igual a `AI_WORKER_SECRET` del servidor |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Token de `claude setup-token`. Sin él, usa la sesión iniciada con `claude` |
| `IA_WORKER_CLI_PATH` | `claude` | Ruta del ejecutable si no está en el PATH. En Windows debe ser un `.exe` (el instalador nativo de Claude Code lo deja en `%USERPROFILE%\.local\bin\claude.exe`): un `claude.cmd` de npm no se puede lanzar sin shell. El worker lo comprueba al arrancar |
| `IA_WORKER_POLL_SECONDS` | `10` | Espera entre consultas con la cola vacía |
| `IA_WORKER_TIMEOUT_SECONDS` | `300` | Tiempo máximo por CV (30–480: la reserva de un trabajo dura 10 min) |
| `IA_WORKER_CONCURRENCY` | `1` | CV en paralelo (1–4). Más paralelismo agota antes la ventana del plan |
| `IA_WORKER_MODEL` | — | Fuerza un modelo en vez de `AI_MODEL` del servidor |

## Cómo se aísla cada llamada

`claude -p --output-format json --json-schema <esquema> --system-prompt <prompt de RRHH>
--tools "" --restricted --strict-mcp-config --no-session-persistence`, con el CV por stdin y en un
directorio temporal: sin herramientas, sin settings ni CLAUDE.md, sin MCP y sin guardar la sesión en
disco. El proceso hijo no recibe `ANTHROPIC_API_KEY` (así nunca se factura por la API) y la
actualización automática del CLI queda desactivada. Actualícelo a mano y pruebe.

No use `--bare`: ese modo solo acepta una API key e ignora el OAuth.

## Errores y reintentos

| Situación | Qué pasa |
|---|---|
| Límite del plan | La cola espera hasta la renovación; no cuenta como intento |
| Sesión inválida o token caducado | Pausa de 10 min, aviso en el log; no cuenta como intento |
| `claude` no instalado | Pausa de 5 min; no cuenta como intento |
| Respuesta inválida, error o tiempo agotado | Reintento con espera de 2 min × intento; tras 3 intentos, error visible en la postulación |
| CV o criterios cambiaron durante el análisis | Vuelve a la cola y se rearma con los datos nuevos |
| El worker se cae a mitad de un CV | La reserva vence a los 10 min y el trabajo se retoma |
| La app no responde | Reintenta con espera creciente (máx. 5 min) |

## Vigilancia: cómo se sabe si el worker no está atendiendo

- El worker avisa a la app que sigue vivo en cada consulta de trabajo y cada minuto (`POST /api/ia/estado`).
  La app guarda ese latido en `ai_worker_status`.
- Si pasan **3 minutos sin latido**, o el worker está en pausa, RRHH ve un aviso en el **panel** y en
  la **postulación** con IA en cola. Por ejemplo: «El servicio de IA no responde desde…», «hay que
  renovar su sesión de Claude» o «límite del plan, se reanuda hacia las…».
- Si la pausa requiere intervenir (sesión de Claude inválida o `claude` no disponible), la app
  **envía un correo a cada administrador activo**, una sola vez por pausa. Necesita el correo en modo
  `live` (`EMAIL_DELIVERY_MODE`, ver `docs/configuracion-correo.md`).

## Medir calidad y rendimiento (`npm run medir:ia`)

Evalúa con IA los CV ficticios de `cv-prueba/` exactamente como en producción: mismo prompt, mismo
`claude -p` y misma validación. Lo compara con el motor de reglas y mide segundos y tokens por CV.
Consume del plan. Ejemplos: `npm run medir:ia -- --max 4`,
`npm run medir:ia -- --modelo claude-sonnet-5-5 --concurrencia 3 --salida informe.md`.

Medición del 16/11/2026 con `claude-opus-5-5` (plan Max), 32 CV y 3 en paralelo:

- **Fallos:** 0.
- **Velocidad y consumo:** 14 s por CV de media, con unos 3.200 tokens de entrada y 1.500 de salida por CV. Son unos 250 CV/hora con 1 en paralelo y unos 740 con 3.
- **Orden de los candidatos:** el motor y la IA lo dejan correcto en todos los puestos.
- **Requisitos:** la valoración difiere en el 24 % de los casos (60 de 248). La IA corrige créditos generosos del motor, como «Excel intermedio» acreditado como avanzado y «AutoCAD intermedio» como avanzado. Pero acredita como cumplidos 2 requisitos de estudios que todavía están en curso: candidato a ajustar en el prompt.

## Riesgo aceptado

Los términos de Anthropic piden usar las suscripciones de forma individual y no para atender a los
usuarios de una aplicación. Anthropic puede bloquear este uso sin aviso. Por eso:

- el motor de reglas sigue siendo la primera línea y nunca depende de la IA;
- si la vía se cae, basta con cambiar `AI_PROVIDER=anthropic` (API de pago, con `AI_API_KEY`) o
  apagar la IA (`none`), sin tocar código.
