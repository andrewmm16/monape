# Escalado del solver de captchas a portales reales — Diseño

Estado: **propuesta** (para revisión). Fecha: 2026-11-12.

Especificación del paso de los captchas **simulados** (ya implementados en los portales
ficticios) hacia un entorno **pre-realista** y, después, **producción**. Cubre en detalle
las **Fases 1 y 2** (lo que se implementa ahora) y deja el resto como hoja de ruta.

## Objetivo

Que el robot resuelva los desafíos de verificación de los portales **reales** de forma
**autónoma, sin intervención humana y sin servicios de pago**, con una arquitectura que
permita desarrollar y medir cada pieza sin golpear sitios de terceros.

## Principio rector

**Evitar > resolver > reintentar/enrutar.** En ese orden de prioridad:

1. **Evitar** el captcha (anti-detección + perfil + ritmo humano) — lo más fiable y barato.
2. **Resolver** solo lo que quede, con solvers gratuitos self-hosted (slider/OCR/visión/audio).
3. **Reintentar o enrutar** por la API/feed oficial donde exista. **Nunca** esperar a una persona.

Realidad asumida (de la investigación 2026): no existe un solver gratuito y autónomo que
resuelva de forma fiable reCAPTCHA v3, Cloudflare, hCaptcha ni Arkose. Por eso el valor está
en *evitar* y en la *vía oficial*, y los solvers se construyen **según lo que la métrica diga
que aparece de verdad**, no por adelantado.

## Estado actual (lo que ya existe)

- 7 desafíos **simulados** en los portales ficticios (`suma`, `texto`, `casilla`, `imagenes`,
  `rotar`, `slider`, `otp`), con la respuesta derivable del DOM. Ver `bot/src/fake-portal/`.
- `adapters/fake-base.ts::guard()` detecta el desafío, lo resuelve con
  `utils/captcha-solver.ts` (despachador por tipo), reintenta 3× y **no** cae en relevo humano.
- `browser.ts::openSession()` ya abre Chromium con **perfil persistente** (`launchPersistentContext`).
- Existe un modelo auto-hospedado compatible con OpenAI para la reparación de selectores
  (`BOT_REPAIR_PROVIDER`), reutilizable para visión.

## Alcance de este documento

- **Fase 1 (ahora):** extraer una **interfaz `DesafioSolver`** enchufable; el solver
  determinista actual pasa a ser una implementación de esa interfaz. Sin cambio de comportamiento.
- **Fase 2 (ahora):** **capa de anti-detección** (patchright drop-in + endurecimiento + warm-up)
  y **métrica** de cuántos/qué desafíos aparecen por portal.
- **Fases 3–5 (hoja de ruta, no se implementan aún):** entorno pre-realista con claves de
  prueba; microservicio `/solve` (OpenCV/OCR/VLM/Whisper); enrutado por API/feed oficial.

---

## Fase 1 — Interfaz `DesafioSolver`

### Motivación
Hoy `guard()` llama directamente al solver determinista de los portales ficticios. Para escalar,
el **punto de detección y el flujo** (detectar → resolver → verificar → reintentar) deben quedar
fijos, y lo que cambie entre entornos sea solo el **motor de resolución**.

### Diseño
- Nueva interfaz en `bot/src/captcha/solver.ts`:

  ```ts
  export interface DesafioContexto {
    page: Page;                         // página con el desafío
    probe(clave: string, o?: { all?: boolean }): Promise<Locator | null>;
    obtenerCodigoOtp?(): Promise<string | null>;
    log?(mensaje: string): void;
  }
  export interface DesafioSolver {
    /** ¿este solver reconoce el desafío presente en la página? */
    reconoce(ctx: DesafioContexto): Promise<boolean>;
    /** intenta resolverlo; `true` si aplicó una solución (el llamador reconfirma). */
    resolver(ctx: DesafioContexto): Promise<boolean>;
  }
  ```

- Un **registro** de solvers (`registerSolver`) y un **despachador** `resolverDesafio(ctx)` que
  recorre los solvers registrados, usa el primero cuyo `reconoce()` dé `true`, y si ninguno
  reconoce el desafío devuelve `false`.
- El solver determinista actual (`utils/captcha-solver.ts`) se envuelve como
  `SolverSimulado implements DesafioSolver` y se registra por defecto. **El comportamiento y
  todos los tests actuales siguen igual.**
- `guard()` deja de llamar a `resolverDesafioLocal` directamente y pasa a usar el despachador,
  con el mismo bucle de 3 reintentos y el mismo log.

### Criterios de aceptación
- `test:bot` y los tests unitarios de captcha siguen **todos en verde** sin cambios de aserción
  (salvo imports), demostrando que el refactor no altera el comportamiento.
- Añadir un solver nuevo es `registerSolver(...)`, sin tocar `guard()`.

### No incluye
- Ningún solver real todavía. Solo la interfaz y el reempaquetado del solver actual.

---

## Fase 2 — Anti-detección y métrica

### 2A. Anti-detección (evitar el captcha)

**Cambio principal (quirúrgico):** en `browser.ts`, sustituir el `chromium` de
`@playwright/test` por el de **`patchright`** (reemplazo directo de la API de Playwright en Node,
que parchea las señales que delatan la automatización). El resto de `openSession()` no cambia.

- Dependencia nueva: `patchright` (Node). Se instala con autorización explícita (toca
  `package.json`); no se añade sin aprobación.
- Endurecimiento del lanzamiento (dentro de `launchPersistentContext`): quitar flags que
  delatan, fijar `locale`/`timezone`/`userAgent` coherentes con el perfil, `viewport` estable.
- **Perfil por cuenta:** ya existe `BOT_PROFILE_DIR`; se documenta que cada cuenta/portal real
  usa su propio `profileDir` persistente (sesión + huella estables).
- **Warm-up opcional:** antes de la primera acción, navegar a la home del portal y esperar un
  tiempo con jitter (reutiliza `BOT_PAUSE_JITTER`), para no entrar "en frío".
- Se mantiene lo que ya ayuda: `BOT_PAUSE_JITTER`, `BOT_WORK_HOURS/DAYS`, `BOT_PAUSE_MS`.

**Nota de reversibilidad:** patchright es drop-in; si diera problemas, se revierte el import a
`@playwright/test` sin tocar el resto.

### 2B. Métrica de desafíos (medir antes de invertir)

Objetivo: saber **cuántos y de qué tipo** desafíos aparecen de verdad por portal, para decidir
qué solvers reales construir (Fase 4) con datos, no a ciegas.

- En `guard()`, cada vez que se detecta un desafío se registra un evento en
  `bot/.state/desafios.json` (escritura atómica, ignorado por git, patrón idéntico a
  `tolerancias.json`): `{ timestamp, portal, tipo, resuelto, intentos }`. **Sin datos personales.**
- Variable `BOT_DESAFIOS_FILE` (por defecto `bot/.state/desafios.json`), como las demás rutas de estado.
- Un pequeño informe de lectura (`npm run bot:desafios-report`): conteo por portal y por tipo, y
  tasa de resolución. Reutiliza el estilo de `training-report`.

### Criterios de aceptación
- El bot arranca y trabaja con patchright exactamente igual contra los portales ficticios
  (`test:bot` en verde; el cambio de `chromium` no rompe la suite).
- Tras un ciclo con un desafío activo, `desafios.json` tiene un evento con el tipo correcto.
- El informe imprime conteos por portal/tipo.

### No incluye
- Solvers de proveedores reales, widgets con claves de prueba ni microservicio de visión (Fases 3–4).

---

## Hoja de ruta (Fases 3–5, para después)

- **Fase 3 — Entorno pre-realista (flujo de token):** montar en los portales ficticios los
  **widgets reales** con **claves de prueba oficiales** (Cloudflare Turnstile `3x…FF` fuerza reto;
  hCaptcha Pro/Enterprise; reCAPTCHA v2 test). Valida detección de widget → token → envío →
  `siteverify` → manejo de token caducado/`timeout-or-duplicate`. **No entrena visión**: para eso
  siguen sirviendo los 7 simulados.
- **Fase 4 — Microservicio local `/solve` (self-hosted, coste 0):** un servicio que enruta por
  tipo: **slider → OpenCV** (hallar el hueco) + arrastre realista (ya hecho); **texto → OCR**
  (Tesseract/PaddleOCR); **grid → VLM propio** (familia Qwen-VL servida con vLLM por el **mismo
  endpoint OpenAI** que ya usa la reparación de selectores); **audio reCAPTCHA v2 → Whisper local**.
  Devuelve respuesta + confianza; con registro de aciertos para medir si vale la pena cada ruta.
- **Fase 5 — Enrutado por vía oficial:** donde exista API/feed (p. ej. **Indeed Job Sync API**
  con sandbox; ATS para Computrabajo/Bumeran), publicar por ahí **evita el captcha** y es lo más
  robusto para producción.

## Riesgos y notas

- **hCaptcha / Arkose:** se tratan como **no resolubles de forma fiable y gratuita**. No se
  planifican como "resueltos": ante ellos el bot reintenta/enruta, no espera a una persona.
- **Cloudflare / reCAPTCHA v3:** no se "resuelven"; se *evitan* con la Fase 2. FlareSolverr
  admite en su propio README que sus solvers no funcionan: no se adopta como pieza central.
- **patchright y vLLM** añaden dependencias/infra; se incorporan solo con aprobación explícita.

## Decisiones abiertas (para la revisión)

1. ¿Confirmas añadir la dependencia `patchright` en la Fase 2?
2. ¿El informe de métrica como comando aparte (`bot:desafios-report`) o integrado en el de entrenamiento?
3. ¿Ubicación de la interfaz: `bot/src/captcha/` (nuevo módulo) como propongo?
