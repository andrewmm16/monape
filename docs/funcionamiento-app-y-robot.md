# Cómo funciona la app y cómo está hecho el robot

> Documento de referencia escrito el **12/11/2026**. Reúne, en un solo lugar, cómo
> funciona toda la plataforma y, en detalle, el subsistema del **robot de portales**.
> Incluye al final un registro exacto de **qué se eliminó al quitar el CAPTCHA** y
> **cómo reconstruirlo** si alguna vez se quiere volver a tener esa capacidad.
>
> Complementa (no reemplaza) a `docs/arquitectura.md`, `docs/como-funciona.md`,
> `docs/seguridad.md` y `bot/README.md`.

---

## 1. Qué es la plataforma

Aplicación web **privada** para el área de **Recursos Humanos**. Reúne en un solo
lugar las vacantes, los CV de los postulantes y la evaluación de cada uno. Compara
cada CV con los requisitos del puesto y muestra la evidencia encontrada.

Cada decisión queda registrada (auditoría).

## 2. Stack

- **Web:** Next.js (App Router, Server Actions, Route Handlers), React 19, TypeScript
  estricto, Tailwind CSS 4, shadcn/ui.
- **Datos:** Supabase — PostgreSQL con RLS en todas las tablas, Auth y Storage privado.
- **Pruebas:** Vitest (unidad y base con PGlite) + Playwright (e2e y portales ficticios).
- **Node 24** (`engines`: `24.x`).
- **Subsistemas (carpetas):** `src/` (app web), `bot/` (robot de portales),
  `correo/` (ingesta por correo), `mercado/` y `scripts/caleta/` (sourcing de
  candidatos), `supabase/` (migraciones y RLS).

## 3. Estructura del repositorio

```
src/
  app/                 Rutas (App Router): área privada + autenticación + descarga auditada de CV
  proxy.ts             Sesión, redirección y Content Security Policy
  components/          UI (shadcn/ui) + componentes por dominio
  modules/<dominio>/   schemas.ts (Zod), queries.ts (lecturas RLS), actions.ts (Server Actions)
    evaluation/        Motor de reglas, puntuación y adaptador de IA (lógica pura + servicio)
    resumes/           Validación de archivos, inspección DOCX, extracción y sugerencias
    portals/           Estado del robot visto desde la app (semáforo, avisos)
  lib/                 Entorno, clientes Supabase, sesión/permisos, errores, auditoría, límites
supabase/              Migraciones, RLS, funciones SQL, Storage y config.toml
bot/                   Robot de portales (servicio aparte)
correo/ mercado/ scripts/caleta/   Ingesta por correo y sourcing de candidatos
tests/                unit/ · db/ · e2e/ · bot/ · fixtures/
```

## 4. Cómo funciona la app (resumen por capas)

- **Seguridad en tres capas:** (1) la interfaz oculta acciones no permitidas
  (comodidad); (2) el servidor **autoriza cada acción** (`requirePermission`) antes de
  tocar datos; (3) la base de datos aplica **RLS** y privilegios por columna (garantía
  final). Validación con **Zod en el servidor** además del cliente.
- **Escrituras críticas en la base de datos:** cambio de estado, registro de
  evaluaciones, revisión y aprobación de criterios son **funciones SQL transaccionales**
  (`SECURITY DEFINER`, triggers) que registran su historial; la aplicación no puede
  modificar esas columnas directamente.
- **Evaluación pura y determinista** (`src/modules/evaluation`), probada sin red; la
  base de datos **recalcula los porcentajes** como verificación cruzada. La evaluación
  es **orientativa**: no cambia el estado ni decide por nadie.
- **Storage auditado:** todo acceso a los CV pasa por el servidor, se autoriza y se
  audita (`/app/api/resumes/[id]/download`).- **Sin infraestructura adicional:** límites de solicitudes en PostgreSQL; sin colas
  ni Redis.

---

## 5. El robot de portales (`bot/`)

### 5.1. Qué hace y su estado

Servicio **aparte** de la app Next.js. Publica y retira las ofertas que RRHH pide en
la pestaña «Portales» de una vacante, y trae los postulantes (con su CV) a la app.
Habla con la app **solo** por `/api/bot/*`.

**Estado actual:** probado contra **cinco portales ficticios** (simulaciones de
LinkedIn, Bumeran, Trabajos Diarios, Indeed y Computrabajo; no son los reales ni copian
su marca). **Todavía no existe el adaptador de ningún portal real.**

### 5.2. Piezas principales

| Pieza | Archivo(s) | Rol |
|---|---|---|
| **Adaptadores** | `bot/src/adapters/fake-*.ts`, `fake-base.ts` | Un adaptador por portal. `FakeSiteAdapter` (base) reúne lo común: pestaña propia, detección de sesión, descarga de CV. Cada adaptador solo **navega** el portal; no habla con la app. |
| **Libro de selectores** | `bot/src/selectors.ts` + el `*_BOOK` de cada adaptador | Por clave lógica (`campo_titulo`, `boton_enviar`, `lista_postulantes`…): descripción, indicador `estricto`, selector CSS por defecto y alternativas tolerantes. Resolución: override aprobado → defecto → alternativas (si no es estricto). |
| **`guard()`** | `bot/src/adapters/fake-base.ts` | Antes de operar, detecta lo que solo una persona puede resolver (**sesión vencida**) y la oferta inexistente (404); acepta el aviso de cookies si tapa la página. |
| **Vuelta y ciclo** | `bot/src/round.ts`, `bot/src/runner.ts` | Una «vuelta» = un `runCycle` por portal no detenido, uno a la vez (navegador compartido, una pestaña por portal). Si uno se detiene, se marca y los demás siguen. |
| **Bucle principal** | `bot/src/index.ts` | Orquesta las vueltas, el relevo de verificaciones, los avisos y las órdenes. |
| **Taxonomía de errores** | `bot/src/errors.ts` | Códigos de fallo y conjuntos `HUMAN_REQUIRED`, `WAITABLE`, `NOT_REPAIRABLE`. |
| **Incidentes** | `bot/src/incidents.ts` | Cada fallo se guarda como JSON en `bot/.state/incidentes/`. |
| **Reparación asistida por IA** | `bot/src/repair/*` | Opcional; propone un override de selector cuando el portal cambia su estructura. Una persona lo aprueba. |
| **Avisos/órdenes por WhatsApp** | `bot/src/notify/*` | Al responsable técnico: arranque, detenciones, fallos seguidos, recuperación, resumen diario y órdenes (`estado`, `pausar`, `reanudar`, `ahora`, `listo`…). |
| **Portal ficticio** | `bot/src/fake-portal/*` | Cinco sitios falsos para probar y hacer la demo sin tocar un portal real, con panel de simulación de fallas. |

### 5.3. Prueba diaria de estructura

Al arrancar y cada `BOT_HEALTH_CHECK_HOURS` (24 por defecto), antes de tocar la cola,
el robot llama a `healthCheck()` del adaptador: abre las pantallas que usa y comprueba
que sigan los campos y botones esperados, **sin escribir ni enviar nada**. Si falla
(dos intentos), el robot se detiene y la app avisa a RRHH con la causa. Así un cambio
del portal se detecta antes de que falle una publicación real.

### 5.4. Detenciones que esperan a una persona («relevo»)

Cuando el robot se detiene por algo que **solo una persona resuelve**, no se reinicia:
deja la ventana abierta y espera la orden `listo` (puede resolverse por acceso remoto a
la PC del robot). Esto aplica a **sesión vencida** (`sesion_expirada`) y a un eventual
**código de verificación** de un portal real (`verificacion_requerida`). Ver
`WAITABLE` e `isWaitingHuman()` en `bot/src/round.ts`.

### 5.5. Códigos de error del robot (`bot/src/errors.ts`)

| Código | Significado | Lo resuelve |
|---|---|---|
| `sesion_expirada` | La sesión del portal venció | Una persona inicia sesión (relevo) |
| `verificacion_requerida` | El portal pide un **código de verificación** | Una persona, en la ventana (relevo) |
| `pagina_cambio` | El portal cambió su página | Corregir el adaptador (a mano o reparación IA) |
| `navegador_cerrado` | Se cerró la ventana del robot | Reiniciar el robot |
| `portal_no_disponible` | El portal no responde (red/DNS) | Reintento automático |
| `api_no_disponible` | La app no respondió | Reintento automático |
| `publicacion_rechazada` | El portal rechazó la oferta | Revisar el contenido |
| `oferta_no_encontrada` | La oferta ya no existe en el portal | — |
| `fallos_seguidos` | Varios trabajos seguidos fallaron | El robot detiene ese portal para no vaciar la cola |

> **Nota importante (tras quitar el CAPTCHA):** `verificacion_requerida` **sigue
> existiendo** como estado genérico de «código de verificación», pero **ya no hay
> ningún disparador en tiempo de ejecución** que lo produzca en los portales ficticios
> (su único origen era la detección de CAPTCHA, eliminada). El estado, el mecanismo de
> relevo y su presentación en la app quedan intactos, listos para un adaptador real que
> encuentre un código de verificación. Ver la sección 6.

---

## 6. Qué se eliminó al quitar el CAPTCHA (y cómo reconstruirlo)

> **Histórico (12/11/2026).** Después, el manejo de CAPTCHA se volvió a incorporar con otro diseño (`bot/src/captcha/`): ver [escalado-captcha.md](escalado-captcha.md). Esta sección queda como registro de lo que se quitó entonces; no describe el código actual.

El **12/11/2026** se eliminó toda referencia al CAPTCHA del proyecto, incluida la
**funcionalidad** (detección, selector, simulación y tests), por pedido expreso. Se
**conservó** el estado genérico `verificacion_requerida` y el mecanismo de relevo.

### 6.1. Qué se quitó, archivo por archivo

**Núcleo del robot (`bot/src/`):**

- `adapters/fake-base.ts` — En `guard()` se eliminó la línea que detectaba el CAPTCHA
  en pantalla y lanzaba `verificacion_requerida`:
  ```ts
  if ((await page.locator(this.sel("captcha")).count()) > 0) throw new PortalError(ERROR_CODES.verificationRequired);
  ```
- `adapters/fake.ts`, `fake-bumeran.ts`, `fake-computrabajo.ts`, `fake-indeed.ts`,
  `fake-linkedin.ts` — Se quitó, en cada libro de selectores, la clave:
  ```ts
  captcha: estricto("Aviso de verificación humana (CAPTCHA)", "<selector del portal>"),
  ```
  y se quitó `, ${this.sel("captcha")}` de las esperas (`waitFor`) de `next()` y
  `publish()` (ahora esperan solo la marca del paso o el resultado publicada/error).
- `selectors.ts`, `errors.ts`, `index.ts`, `round.ts`, `incidents.ts`, `login.ts`,
  `notify/control.ts` — Solo **texto** (comentarios y mensajes): se cambió «CAPTCHA»
  por «verificación/código». No cambió la lógica.

**Portal ficticio (`bot/src/fake-portal/`):**

- `model.ts` — Se quitó `captcha: boolean;` de `PortalFlags`.
- `sites.ts` — Se quitó el campo `captcha: string;` del tipo de atributos y su valor
  en los cinco portales (`#challenge-dialog`, `.recaptcha-caja`, `#captcha`,
  `#cf-challenge`, `[data-testid=captcha]`).
- `candidate.ts` — Se eliminó la función `renderCaptcha()` completa.
- `server.ts` — Se quitó el import de `renderCaptcha`, el método `setCaptcha()` de la
  interfaz `FakePortal` y de su retorno, el flag `captcha` de `freshFlags()`, la
  detección `if (f.captcha) return send(200, renderCaptcha(...))`, el parámetro
  `captcha` en el handler de `/__fake/modo` y las entradas de CAPTCHA del panel de
  simulación.

**App web (`src/`):**

- `lib/labels.ts` — El texto de `verificacion_requerida` ya no menciona CAPTCHA.
- `modules/portals/queries.ts` — Comentario sin CAPTCHA.
- `components/app-shell/bot-alert-banner.tsx` y `modules/portals/estado-ui.ts` — **No
  se tocaron**: referencian el código `verificacion_requerida`, que se conserva.

**Base de datos:** `supabase/migrations/20261029000200_bot_status.sql` — Solo un
comentario; la columna `reason` **no** restringe valores por lista (valida el formato
`^[a-z0-9_]{1,64}$`), así que no hubo cambio de esquema.

**Otros subsistemas (scraping, no es el robot):**

- `mercado/src/scrape.ts` — Comentario y texto de error sin la palabra «captcha».
- `scripts/caleta/*.mjs` — Se quitó el término `captcha` de las expresiones regulares
  que detectan bloqueo de Google; **la detección sigue** por los otros patrones
  (`unusual traffic`, `not a robot`, `anomaly detected`, `blocked`, etc.).
- `scripts/caleta/README.md`, `supabase/config.toml` — Menciones de texto y boilerplate
  comentado de proveedores de captcha de Supabase Auth (hCaptcha/Turnstile), eliminados.

**Tests:**

- `tests/bot/fake-portal.test.ts`, `tests/bot/fake-portals.test.ts` — Se eliminaron los
  tests dedicados al CAPTCHA; el test «/__fake/modo actúa por portal» ahora usa
  `sesion=0` en vez de `captcha=1`.
- `tests/bot/multi-adapter.test.ts` — La detención de un portal se provoca ahora con
  `setLoggedIn(false, ...)` (sesión) en vez de `setCaptcha(...)`.
- `tests/unit/bot-round-relevo.test.ts` — Conserva `verificacion_requerida` como estado
  de espera (solo se ajustó el texto del test).

### 6.3. Verificación tras la eliminación

- `npm run typecheck`: sin errores atribuibles a este cambio (el único error era
  preexistente y ajeno: `fs-extra` sin tipos en `mercado/src/importarCaleta.ts`, un
  borrador sin uso que se eliminó el 18/11/2026).
- Tests de los proyectos `unit` y `bot`: **1260 pasan**. Los 3 fallos restantes son de
  `tests/unit/caleta-lector-cv-lote.test.ts` por el directorio `cv-prueba/` borrado del
  repo — sin relación con el CAPTCHA.
- Búsqueda `captcha` (sin distinguir mayúsculas) en el proyecto: **0 coincidencias**.
