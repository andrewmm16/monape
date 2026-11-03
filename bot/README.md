# Robot de portales

Servicio aparte de la app Next.js. Publica y retira las ofertas que RRHH pide en la pestaña «Portales» de una vacante, y trae los postulantes (con su CV) a la app. Habla con la app solo por `/api/bot/*`.

**Estado:** probado contra **cinco portales ficticios** (simulaciones de LinkedIn, Bumeran, Trabajos Diarios, Indeed y Computrabajo; no son los portales reales ni copian su marca). Todavía no existe el adaptador de ningún portal real.

## Reglas que el robot respeta

- **No inicia sesión por su cuenta.** Una persona inicia sesión a mano (`npm run bot:login`) y la sesión queda en `bot/.profile/`. El robot nunca guarda ni escribe usuario o contraseña.
- **Ante un CAPTCHA, un código de verificación o una sesión vencida se detiene** y lo reporta (`verificacion_requerida`, `sesion_expirada`). No intenta resolverlo ni esquivarlo.
- **Si el portal cambió su página** reporta `pagina_cambio`; tras dos fallos seguidos se detiene.
- Usa un navegador **visible** por defecto y pausas fijas entre acciones (`BOT_PAUSE_MS`).
- Si no logra informar a la app un resultado, se detiene y deja el enlace de la oferta en el log, para no publicar dos veces.
- El log solo lleva ids y conteos, nunca datos de postulantes.
- `bot/.profile/` y `bot/.state/` están en `.gitignore`. La primera equivale a la sesión iniciada: no se comparte.

## Prueba diaria de estructura

Al arrancar y luego cada `BOT_HEALTH_CHECK_HOURS` (24 por defecto; 0 la apaga), antes de tocar la cola, el robot llama a `healthCheck()` del adaptador: abre las pantallas que usa (publicar, lista de postulantes) y comprueba que sigan los campos y botones esperados, **sin escribir ni enviar nada**. Si falla (dos intentos, por si fue la red), el robot se detiene sin publicar nada y la app avisa a RRHH con la causa (`pagina_cambio`, `sesion_expirada` o `verificacion_requerida`). Así un cambio del portal se detecta antes de que falle una publicación real. No repara nada solo: el adaptador se corrige a mano con capturas del cambio.

Cada adaptador debe implementar `healthCheck()` cubriendo **todas** las pantallas y elementos que usa, no solo la primera.

En los adaptadores ficticios (`fake-base.ts`), la prueba: (1) recorre el formulario de publicar en una pestaña nueva, con datos de prueba, hasta el último paso y comprueba con un clic «de prueba» (`assertSubmittable`) que el botón de enviar existe, no está tapado y que el formulario no exige campos desconocidos; cierra la pestaña sin enviar ni guardar borrador; (2) con ofertas existentes, comprueba la lista de candidatos, el enlace al CV del primer postulante (sin descargarlo) y el botón de retirar con su texto (sin pulsarlo). Si no hay ofertas, postulantes u ofertas activas, esos pasos no fallan: quedan en `healthCheckGaps()` (método opcional del adaptador) y el runner los deja en el log.

## Avisos a RRHH

Al terminar cada ciclo el robot informa su estado a `POST /api/bot/estado`. La app muestra un aviso rojo en todas las pantallas cuando:
- **El robot necesita a una persona** (CAPTCHA, código de verificación, sesión vencida, fallos seguidos): el aviso dice la causa y cuándo se detuvo.
- **El robot no da señales** durante más de 15 minutos (PC apagada o robot cerrado).

Para resolverlo, en la PC del robot: `npm run bot:login` (iniciar sesión o resolver la verificación a mano), luego `npm run bot` y, en la vacante, «Publicar» de nuevo en los portales con error. El primer ciclo correcto borra el aviso. Un robot que nunca se ha conectado no genera aviso.

## Avisos y órdenes por WhatsApp (solo al responsable técnico)

Con `BOT_NOTIFY_PHONE` definido, el robot escribe en el chat del propio responsable («Tú») cuando arranca, se detiene (sesión vencida, verificación, portal cambiado), lleva 3 ciclos fallidos seguidos o se recupera. Usa Baileys, una librería **no oficial**: WhatsApp puede restringir la cuenta vinculada. Si el canal falla, el robot sigue trabajando.

1. Agregue `BOT_NOTIFY_PHONE=<código de país + número, solo dígitos>` en `.env.bot`.
2. `npm run bot:whatsapp-login -- --qr` abre una página con un QR; escanéelo en WhatsApp > Dispositivos vinculados > Vincular un dispositivo (es la vía que funcionó; la sesión se reinicia sola una vez, «código 515», y es normal). Sin `--qr` muestra un código de 8 caracteres, que en las pruebas con la versión 7.0.0-rc14 de Baileys el teléfono rechazó. Vincular borra la sesión anterior. La sesión queda en `bot/.state/whatsapp/` (ignorada por git; es sensible). La terminal puede mostrar un volcado «Closing session…» de la librería: contiene claves, no lo comparta.
3. `npm run bot` ya avisa. Desde el chat «Tú» se aceptan solo estas órdenes exactas, enviadas desde la misma cuenta: `estado`, `pausar`, `reanudar`, `ahora`, `ayuda`, `incidentes`, y `sí N` / `no N` para decidir el incidente N.

Nunca se envían datos de postulantes. Un CAPTCHA, código o sesión vencida se resuelve en la PC del robot; si el robot se detuvo, el proceso termina y ya no recibe órdenes. La terminal ya no muestra el volcado «Closing session…» de la librería.

## Incidentes

Cada fallo con un portal (publicar, retirar, leer postulantes, bajar un CV o la prueba de estructura) queda guardado como un archivo JSON en `bot/.state/incidentes/` (`BOT_INCIDENTS_DIR`; ignorado por git) y avisa una sola vez por WhatsApp. Cada incidente lleva: número, portal, paso, código de error, mensaje sin correos, teléfonos ni parámetros de enlaces, si lo resuelve una persona (`reparable: false`) y, si el adaptador implementa `captureStructure()`, el esquema de la pantalla (campos y botones, **sin** valores ni textos de contenido). El mismo fallo repetido en 6 horas suma `occurrences` en vez de crear otro.

«sí N» / «no N» marca el incidente como `aprobado` o `rechazado`. Sin reparación asistida (ver abajo) solo deja constancia; con una propuesta pendiente, «sí N» además la aplica y «no N» la rechaza.

## Selectores tolerantes (libro de selectores)

Los adaptadores no llevan selectores sueltos en el código: cada uno declara un **libro de selectores** (`bot/src/selectors.ts`; ver el `*_BOOK` de cada `bot/src/adapters/fake-*.ts`). Por cada clave lógica (`campo_titulo`, `enlace_cv`, `lista_postulantes`, `boton_enviar`, `boton_retirar`…) hay una descripción, un indicador `estricto`, un selector CSS por defecto y alternativas tolerantes (por rol, etiqueta, texto con sinónimos o un CSS más laxo). Orden de resolución: **override aprobado** (`bot/.state/selectores.json`) → **selector por defecto** → **alternativas** (solo si no es estricto). Si no se encuentra por ninguna vía: `pagina_cambio`, como siempre.

- **Tolerantes** (lectura y rellenado reversible): lista de postulantes, filas, enlace al CV, campos del formulario, botones de navegación («Siguiente», «Atrás») y avisos de cookies (se aceptan).
- **Estrictos** (solo selector exacto o un override aprobado por una persona): el botón final de enviar/publicar y el botón de retirar, más las marcas que deciden el resultado (publicada / error, marca del paso, CAPTCHA, estado cerrado). Un clic o una lectura equivocados ahí publicarían o retirarían de verdad.
- Cuando se usa algo distinto del selector por defecto el robot **sigue**, lo deja en el log y anota `{timestamp, portal, clave, indiceUsado}` en `bot/.state/tolerancias.json` (últimos 500, escritura atómica, ignorado por git; `BOT_TOLERANCES_FILE`) para corregir el adaptador sin prisa. Los selectores no llevan datos personales.
- Efecto en el entrenamiento: `renombrar_campo` y `aviso_cookies` ya no detienen al robot (los absorbe la tolerancia); `texto_boton`, `boton_en_menu` y el resto siguen detectándose. El informe los marca «absorbido (tolerado)» (ver más abajo).

## Reparación asistida por IA (opcional, desactivada sin clave)

Cuando un incidente nuevo es `reparable` y trae el esquema de la pantalla, el robot puede pedir a un modelo **una propuesta**: qué clave del libro de selectores falló y qué selector CSS nuevo usar. Es solo una propuesta: **una persona decide** por WhatsApp.

**Activar.** Ponga `ANTHROPIC_API_KEY=<su clave>` en `.env.bot` (la lee el SDK oficial desde el entorno; el robot no la guarda ni la registra) y reinicie el robot. Sin la clave todo queda desactivado y el robot se comporta como antes; el arranque lo anota en el log.

**Con un modelo propio (Qwen u otro) en lugar de Anthropic.** Ponga en `.env.bot`: `BOT_REPAIR_PROVIDER=openai`, `BOT_REPAIR_BASE_URL=http://servidor:8000/v1` y `BOT_REPAIR_MODEL=<nombre exacto en su servidor>` (más `BOT_REPAIR_API_KEY` si pide token). Todo lo demás del flujo es igual (ensayo previo, aviso por WhatsApp, «sí N», reversión): solo cambia quién responde. El cliente quita solo el razonamiento `<think>…</think>` y las vallas ```` ```json ```` que algunos modelos añaden, y el tiempo de espera es mayor. Si el servidor es interno, el esquema saneado y el mensaje del incidente no salen de la red de la empresa. Si el servidor responde 400 mencionando `response_format`, deje `BOT_REPAIR_JSON_MODE=prompt`.

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API. Sin ella no hay reparación asistida. |
| `BOT_REPAIR_MODEL` | Modelo (ID exacto, por defecto `claude-sonnet-5-5`). |
| `BOT_REPAIR_MAX_PER_DAY` | Máximo de consultas al modelo por día (0–1000, por defecto 10; 0 = apagado). Se cuentan todas las consultas, también las que no dieron propuesta. |
| `BOT_REPAIR_VERIFY_MINUTES` | Ventana tras aplicar una propuesta en la que un fallo de la comprobación del portal la revierte sola (1–1440, por defecto 30). |
| `BOT_REPAIR_MAX_ATTEMPTS` | Intentos máximos por incidente (1–5, por defecto 3): cada propuesta se PRUEBA y, si falla, se pide una corrección al modelo. Cada intento cuenta para `BOT_REPAIR_MAX_PER_DAY`. |
| `BOT_REPAIR_PROVIDER` | `anthropic` (por defecto) u `openai`: cualquier servidor compatible con OpenAI (`POST {base}/chat/completions`), por ejemplo un Qwen propio servido con vLLM u Ollama. |
| `BOT_REPAIR_BASE_URL` | Solo con `openai` (obligatoria): dirección base terminada en `/v1`, sin usuario ni clave. |
| `BOT_REPAIR_API_KEY` | Solo con `openai` (opcional): token del servidor, si lo pide. Se envía como `Authorization: Bearer` y no se registra. |
| `BOT_REPAIR_JSON_MODE` | `prompt` (por defecto: el formato JSON se pide en el texto, sirve en cualquier servidor) o `schema` (`response_format` json_schema, solo si el servidor lo admite; un 400 que mencione `response_format` indica que no). |
| `BOT_REPAIR_TIMEOUT_SECONDS` | Espera por respuesta de un servidor propio (5–900, por defecto 120). |
| `BOT_PROPOSALS_DIR` / `BOT_SELECTORS_FILE` | Carpeta de propuestas (por defecto `bot/.state/propuestas`) y archivo de overrides (por defecto `bot/.state/selectores.json`). |

**Flujo.**
1. Incidente nuevo reparable con esquema → el robot avisa como siempre y, **sin bloquearse** (todo con try/catch y log), consulta al modelo.
2. **Ensayo antes de proponer.** Si la respuesta es válida, el robot aplica el selector SOLO EN MEMORIA (override temporal «en ensayo»: no se escribe en `selectores.json` y se retira siempre, pase o falle) y ejecuta el `healthCheck()` del portal (no envía, publica ni retira nada). El ensayo se encola y corre en el turno del robot, junto a las comprobaciones de reanudación: nunca en paralelo con un ciclo, porque el navegador es compartido.
   - **Pasa:** se guarda la propuesta con `probada: true` y llega un segundo mensaje: «Propuesta PROBADA para #N: usar «selector» como <clave>; la prueba de estructura pasó con este cambio. Responda «sí N» para aplicarla o «no N» para rechazarla.»
   - **Falla:** se reintenta hasta `BOT_REPAIR_MAX_ATTEMPTS`, devolviendo al modelo el selector probado, el error saneado del ensayo y un esquema fresco de la pantalla. Si se agotan los intentos NO se envía nada aplicable, solo «No encontré una solución probada para #N tras K intentos; hace falta revisar el adaptador.» (la última propuesta queda guardada con `probada: false` solo como consulta y «sí N» no la aplica).
   - **Paso no cubierto** (la prueba de estructura no recorre el paso que falló, p. ej. bajar un CV o leer postulantes sin datos en el portal; se sabe por `healthCheckGaps()`): se envía «Propuesta SIN PROBAR (la prueba de estructura no cubre este paso) …»; «sí N» sí la aplica y la verificación ocurre después (punto 5).
   Queda en `bot/.state/propuestas/<idIncidente>.json`: `incidenteId`, `portal`, `clave`, `selector`, `confianza`, `razon`, `modelo`, `tokensEntrada`, `tokensSalida` (suma de todos los intentos), `creadaEn`, `estado` (`propuesta` | `aplicada` | `revertida` | `rechazada`), `probada`, `intentos` y `ensayo` (`resultado`: `paso` | `fallo` | `no_cubierto`, `mensaje`, `en`). La orden «incidentes» indica si hay propuesta probada.
3. Se descarta (solo log) si el modelo se niega (`refusal`) o se corta (`max_tokens`), si la respuesta no cumple el formato, si responde «sin propuesta», si la clave no existe en el libro de ese portal o si el selector tiene más de 200 caracteres, contiene `<`, `{`, `}`, `;`, `javascript:` o saltos de línea.
4. «sí N» escribe el override en `selectores.json` (con `aprobadoEn` e `incidenteId`), marca la propuesta `aplicada` y responde que la comprobación automática la verificará; «no N» la marca `rechazada`. Si pasaron más de 24 h entre el ensayo y la aprobación, antes de aplicar se vuelve a ensayar y, si ya no pasa, no se aplica y se avisa. Sin propuesta aplicable, «sí/no» funciona como siempre.
5. La siguiente prueba de estructura del portal (reanudación automática o prueba periódica; al aplicar se adelanta) usa el override. Si **pasa**, queda activo y se avisa «Reparación aplicada y verificada». Si **falla dentro de `BOT_REPAIR_VERIFY_MINUTES`**, el override se revierte solo (se restaura el anterior, si lo había), la propuesta pasa a `revertida` y se avisa. Los archivos se escriben de forma atómica y se leen tolerando archivos dañados, así que un ciclo del robot nunca ve un `selectores.json` a medias.

**Qué datos salen hacia el modelo.** Solo el esquema de la pantalla del incidente (campos y botones, ya saneado: sin valores ni textos de contenido), el mensaje de error saneado (sin correos, teléfonos ni parámetros de enlaces), el portal, el paso, el código de error y el libro de selectores del portal (claves, descripciones y selectores). **Nunca** postulantes, CVs ni datos de la app.

**Coste.** No se publica una cifra aproximada: el coste de cada consulta lo muestran los campos `tokensEntrada` y `tokensSalida` guardados en cada propuesta (multiplíquelos por la tarifa vigente de su plan). Cada consulta usa `max_tokens` 2000, esfuerzo bajo, 30 s de límite y un reintento.

El ensayo y la verificación posterior son complementarios: el ensayo evita enviar propuestas que no funcionan; la comprobación posterior y la reversión automática siguen siendo la red de seguridad (el portal puede cambiar entre la prueba y la aprobación).

Limitaciones: la verificación es la prueba de estructura del portal; si esa prueba no recorre el elemento reparado, "verificada" no lo prueba. Un portal detenido por `fallos_seguidos` (no por `pagina_cambio`) no se reanuda solo, así que su override se comprobará en la siguiente prueba periódica o al reiniciar el robot.

## Medir un modelo de reparación (portales ficticios)

Para decidir con datos qué modelo usar (Qwen propio, Sonnet…): `npm run bot:medir-reparacion` (modelo **simulado**, sin red ni costo; sirve para validar la herramienta) o `npm run bot:medir-reparacion -- --real --max 20` (usa el modelo configurado por entorno: `BOT_REPAIR_PROVIDER`, `BOT_REPAIR_BASE_URL`, `BOT_REPAIR_MODEL`, `ANTHROPIC_API_KEY`/`BOT_REPAIR_API_KEY`). Con `--real` imprime antes el número de consultas previstas y el modelo/servidor (sin claves) y espera 5 s para cancelar con Ctrl+C. Otras opciones: `--portal <slug>`, `--max <N>` (casos, repartidos entre portales), `--repeticiones <N>` (cada caso N veces, para ver la variabilidad), `--intentos <N>` (por defecto 1: se mide el primer intento; con más, se reintenta con el error del ensayo como en la reparación real), `--sin-tolerancia` (quita las alternativas de `campo_titulo` para que `renombrar_campo` llegue al modelo en vez de absorberlo la tolerancia) y `--salida <ruta>` (por defecto `bot/.state/medicion-reparacion-<AAAA-MM-DD-HHmm>.md`, más un `.json` con lo mismo).

**Qué hace.** Por cada caso (portal ficticio × cambio estructural del mutador) arranca un portal propio en memoria (puerto 0; no toca el 4011 ni `bot/.state/`, todo va a una carpeta temporal), aplica el cambio, ejecuta la prueba de estructura del adaptador, registra el incidente con su esquema, consulta al modelo y **ensaya** la propuesta como lo hace el robot.

**Cómo leer el informe.** Resultado por caso: `probada` (el ensayo pasó), `sin_probar` (pasó pero la prueba no cubre ese paso), `fallo_ensayo`, `sin_propuesta` (el modelo no propuso o respondió algo ilegible), `propuesta_invalida` (clave inexistente, selector rechazado o igual al vigente), `error_consulta` (el cliente lanzó una excepción), `absorbido` (la tolerancia ya lo resuelve: no hay incidente y no se consulta). Además `no_detectado` (la prueba de estructura no nota el cambio con los datos del portal ficticio; no se consulta) y `error_medicion`. Los resúmenes por resultado, por tipo de cambio y por portal dan el % de `probada`; también hay latencia media y p95 (solo la espera al modelo) y tokens totales. Para comparar modelos, use el mismo `--max`/`--repeticiones` y compare el % de `probada` sobre los casos que sí llegaron a consultar al modelo.

**Límites.** NO es una prueba contra portales reales. Con los selectores tolerantes actuales, la mayoría de los cambios que llegan al modelo (`boton_en_menu`, `paso_extra`, `campo_obligatorio`, `campo_a_lista`…) no tienen arreglo con un selector nuevo, así que se esperan `propuesta_invalida`/`fallo_ensayo` incluso con un buen modelo; el único que un selector repara es `renombrar_campo` (use `--sin-tolerancia` para medirlo). Un cambio de «texto del botón», la paginación y el enlace al CV no se detectan sin ofertas o postulantes en el portal ficticio recién arrancado (`no_detectado`).

## Cómo funciona un ciclo

1. `POST /api/bot/publicaciones/siguiente` → trabajo (publicar o retirar). Se repite hasta vaciar la cola.
2. El adaptador lo hace en el portal y el robot lo informa en `.../[id]/resultado`.
3. `GET /api/bot/publicaciones/activas` → ofertas publicadas. Por cada una: el adaptador lista los postulantes, baja el CV de los nuevos y los envía a `POST /api/bot/postulantes` (multipart). Al terminar sin fallos, `.../[id]/sincronizada`.

**Retiro.** Antes de retirar una oferta el robot hace una última revisión de sus postulantes (una vez retirada, la app deja de pedirla). Si no logra traerlos todos, NO la retira y reintenta (la app permite 3 intentos y luego marca `retiro_fallido`). Si la oferta ya no existe en el portal (`oferta_no_encontrada`), da el retiro por hecho.

**Oferta que desaparece.** Si al abrir una oferta el portal responde «no existe», el robot guarda un incidente NO reparable (`oferta_no_encontrada`, no es un cambio de la página) y no la vuelve a visitar durante 60 minutos, en vez de esperar el tiempo máximo en cada ciclo. Hoy esa señal solo la detectan los adaptadores ficticios (`guard(page, { offer: true })` en `fake-base.ts`); los adaptadores reales deben lanzar `PortalError(ERROR_CODES.offerNotFound)` cuando el portal indique que la oferta no existe. La app todavía no muestra este estado a RRHH: queda solo en incidentes y log.

La app deduplica por oferta e id externo, así que repetir un envío es inofensivo. `bot/.state/enviados.json` solo evita bajar CV ya entregados.

## Configuración

Copie `bot/env.example` a `.env.bot` (en la raíz; está ignorado por git). `PORTAL_BOT_SECRET` debe ser el mismo que en la app (mínimo 32 caracteres).

| Variable | Descripción |
|---|---|
| `BOT_API_URL` | Dirección de la app. `https`, salvo `localhost`. |
| `PORTAL_BOT_SECRET` | Secreto compartido con la app. |
| `BOT_ADAPTER` | Un adaptador (`fake-linkedin`, `fake-bumeran`, `fake-trabajos-diarios`, `fake-indeed`, `fake-computrabajo`; `fake` = portal falso original), una **lista separada por comas** o `demo` (= los cinco `fake-*`). Los reales se registran en `bot/src/adapters/index.ts`. |
| `BOT_FAKE_PORTAL_URL` | Dirección de los portales ficticios (por defecto `http://127.0.0.1:4010`). |
| `BOT_HEADLESS` | `true` solo para pruebas. Por defecto, navegador visible. |
| `BOT_POLL_SECONDS` | Espera entre ciclos (60–86400, por defecto 600 = 10 minutos; cada ciclo visita cada oferta publicada, así que conviene espaciarlo). |
| `BOT_HEALTH_CHECK_HOURS` | Cada cuántas horas se prueba la estructura del portal (0–168, por defecto 24; 0 = nunca). |
| `BOT_RESUME_CHECK_MINUTES` | Cada cuántos minutos el robot repite SOLO la prueba de estructura de un portal detenido por `pagina_cambio` y, si pasa, lo reanuda (1–1440, por defecto 10; 0 = desactivado: el robot termina como antes). No afecta a `sesion_expirada`, `verificacion_requerida` ni `navegador_cerrado`. |
| `BOT_PAUSE_MS` | Pausa entre acciones en el portal (por defecto 2000). |
| `BOT_SLOWMO_MS` | Retraso de cada acción del navegador (0–5000), para verlo trabajar. |
| `BOT_MAX_JOBS_PER_CYCLE` | Máximo de publicaciones por ciclo (por defecto 10). |
| `BOT_NOTIFY_PHONE` | Número del responsable para avisos por WhatsApp (solo dígitos, con código de país, sin «+»). Vacío = sin avisos. |
| `BOT_WHATSAPP_DIR` | Carpeta de la sesión de WhatsApp (por defecto `bot/.state/whatsapp`). |
| `BOT_INCIDENTS_DIR` | Carpeta de los incidentes (por defecto `bot/.state/incidentes`). |
| `BOT_TOLERANCES_FILE` | Eventos en que se usó un selector alternativo (por defecto `bot/.state/tolerancias.json`). |
| `ANTHROPIC_API_KEY`, `BOT_REPAIR_MODEL`, `BOT_REPAIR_MAX_PER_DAY`, `BOT_REPAIR_VERIFY_MINUTES` | Reparación asistida por IA (opcional): ver «Reparación asistida por IA». |

## Comandos

- `npm run bot:fake-portal`: levanta los cinco portales ficticios y el panel de la demo en `http://127.0.0.1:4010` (puerto con `BOT_FAKE_PORTAL_PORT`). Con `-- --entrenar` (o `BOT_FAKE_MUTATE_MINUTES`) además cambian de estructura solos (y se restablecen solos): ver «Entrenamiento con cambios automáticos».
- `npm run bot:training-report`: informe de entrenamiento (cambios del mutador cruzados con los incidentes del robot; solo lectura). `-- --cada <minutos>` lo repinta cada tanto (modo vigilancia, `Ctrl+C` para salir).
- `npm run bot:login`: abre el navegador del robot para iniciar sesión a mano (con varios portales, una pestaña por portal).
- `npm run bot:whatsapp-login`: vincula WhatsApp con el robot (una vez).
- `npm run bot`: ejecuta el robot (`Ctrl+C` lo detiene al terminar la acción en curso). Sale con código 2 cuando TODOS los portales están detenidos por algo que requiere a una persona (un portal detenido por `pagina_cambio` que puede reanudarse solo no cuenta: ver `BOT_RESUME_CHECK_MINUTES`).
- `npm run test:bot`: el robot completo contra los portales ficticios, con Chromium real. Las pruebas del runner y del cliente están en `npm run test:unit`.

## Demostración para RRHH: el robot publicando en 5 portales

Todo es ficticio: un solo servidor (`npm run bot:fake-portal`, puerto 4010) monta cinco «sitios» con identidad visual inspirada pero propia (colores y tipografía aproximados, nombre en texto, sin logos ni textos de marca) y un banner fijo «Portal ficticio · simulación para demostración». Cada sitio tiene ids y estructura distintos, por eso cada uno tiene su adaptador.

| Portal | Dirección | Adaptador | Publicar |
|---|---|---|---|
| Panel de la demo | `http://127.0.0.1:4010/` | – | Tarjetas por portal con las ofertas del robot (puesto, estado, hora, postulantes); se refresca solo cada 20 s |
| LinkedIn | `/linkedin` | `fake-linkedin` | Asistente de 4 pasos (detalles, descripción y preguntas, cómo recibir candidatos, revisar y publicar) |
| Bumeran | `/bumeran` | `fake-bumeran` | Asistente de 3 pasos |
| Trabajos Diarios | `/trabajos-diarios` | `fake-trabajos-diarios` | Una pantalla |
| Indeed | `/indeed` | `fake-indeed` | 2 pasos |
| Computrabajo | `/computrabajo` | `fake-computrabajo` | Una pantalla |

Cada sitio tiene dos lados. El **empleador** (lo usa el robot): `/<portal>/login`, publicar, lista de postulantes por oferta, descarga de CV y retirar; el panel de ofertas está en «Soy empleador» del encabezado. El **candidato** (público): `/<portal>/empleo/<id de la oferta>`, con el botón de postular (también desde la lista «Empleos» de `/<portal>`).

Pasos con la app, Supabase local y la ventana del robot visibles:
1. `npm run bot:fake-portal` y abra `http://127.0.0.1:4010`.
2. `npm run bot:demo-queue`: crea 10 vacantes ficticias y las reparte entre los 5 portales (2 por portal). Para ello marca `bot_enabled=true` en LinkedIn, Bumeran, Indeed y Computrabajo **solo en la base local** (Trabajos Diarios ya lo tiene); no hay migración que lo haga en una base real.
3. `npm run bot` con `BOT_ADAPTER=demo BOT_HEADLESS=false BOT_SLOWMO_MS=500 BOT_PAUSE_MS=3000 BOT_MAX_JOBS_PER_CYCLE=10`. Un solo navegador, una pestaña por portal, un ciclo por portal en cada vuelta y su propia prueba de estructura. Si un portal se detiene (CAPTCHA, sesión caída, formulario cambiado) el robot lo reporta y sigue con los demás; termina cuando todos están detenidos.
4. `npm run bot:demo-queue -- --limpiar` borra las vacantes de la demostración y vuelve a desactivar solo los portales que el script activó (lo anotado en `bot/.state/demo-portales-activados.json`; nunca toca Trabajos Diarios).

**Postularse a mano como candidato:** abra la oferta publicada desde el panel (el puesto es un enlace) o desde `/<portal>`. En LinkedIn, «Postulación sencilla»: datos de contacto, CV, preguntas, revisar y enviar. En los demás, un formulario con nombre, correo, teléfono y CV en PDF; si no adjunta CV, el portal genera un PDF mínimo con su nombre. El postulante aparece en la lista de postulantes de esa oferta y el robot lo trae en su siguiente ciclo (`BOT_POLL_SECONDS`, mínimo 60; con la orden `ahora` por WhatsApp o reiniciando el robot se adelanta).

**Simular fallas** (por portal, desde el panel o con la dirección):
- `/__fake/modo?portal=linkedin&captcha=1`: pide un CAPTCHA (el robot se detiene con `verificacion_requerida`; en el sitio, «Ya lo resolví» lo quita).
- `&sesion=0`: sesión caída (redirige al login; `sesion_expirada`; «Simular inicio de sesión» en el login la restablece).
- `&cambiado=1`: el formulario cambió (desaparece el campo del título; `pagina_cambio`, la prueba de estructura lo detecta antes de publicar).
- `&rechazar=1`: el portal rechaza la oferta (`publicacion_rechazada`).
- `&restablecer=1`: todo vuelve a la normalidad. Sin `portal` afecta a los cinco. Valores `0`/`1`; acepta GET y POST.
Tras una detención hay que reiniciar el robot (`npm run bot`).

Las rutas de la raíz (`/login`, `/empleos/nuevo`, …) siguen funcionando como alias de `/trabajos-diarios` para el adaptador `fake` anterior.

## Entrenamiento con cambios automáticos

Para probar si el robot detecta los cambios de estructura de un portal, cuánto tarda y si da falsas alarmas, el servidor de portales ficticios tiene un **mutador**: cada cierto tiempo cambia la forma de UN portal (rotando linkedin → bumeran → trabajos-diarios → indeed → computrabajo). El robot **no se repara solo**: el entrenamiento es detección + registro de incidentes (`bot/.state/incidentes/`) + reparación asistida posterior. Todo ocurre en los portales ficticios; no toca ningún portal real.

**Activarlo** (apagado por defecto; las pruebas y `startFakePortal()` sin opciones no tienen temporizador):
- `npm run bot:fake-portal -- --entrenar` (cada 30 minutos), o
- `BOT_FAKE_MUTATE_MINUTES=30` (puede ser otro valor, incluso decimal, para pruebas). `BOT_FAKE_MUTATE_SEED=<entero>` fija la semilla: misma semilla, misma secuencia (sin ella se toma una de la hora y se muestra al arrancar y en `/__fake/mutaciones`).

**Rotación y tope.** Un portal por turno. De cada 3 turnos, 2 son estructurales y 1 cosmético. Como máximo hay **2 portales con un estructural activo**: con 2 activos, el turno aplica un cosmético y lo anota en `omitidos` del diario; un portal con un estructural activo no recibe otro cambio (también se anota en `omitidos`). Cada portal recorre **todo el catálogo que le aplica** (barajado con la semilla) antes de repetir una mutación, estructurales y cosméticas por separado. Al reiniciar el servidor los portales vuelven al original y lo que estaba «activa» pasa a «restablecida».

**Modo continuo (por defecto con `--entrenar`).** Un estructural automático se **restablece solo** cuando ocurre lo primero de: (a) hay un incidente del robot para ese portal posterior al cambio (mismo criterio de atribución que el informe, leído de `BOT_INCIDENTS_DIR`, por defecto `bot/.state/incidentes`) y pasó el **margen de gracia** (3 min por defecto) desde que el robot lo notó; (b) sin incidente, el robot lo **absorbió**: hay un evento de tolerancia de ese portal posterior al cambio (`BOT_TOLERANCES_FILE`, por defecto `bot/.state/tolerancias.json`) y pasó el mismo margen desde ese primer evento; o (c) pasó la **vida máxima** (60 min por defecto) sin detección ni absorción. El diario lo anota con `estado: restablecida`, `restablecida_auto: true`, `motivo` (`detectado` | `absorbido` | `tiempo`) y `restablecidaEn`. El tope de 2 se libera solo, así que el entrenamiento no se estanca y se ven varios cambios repartidos en horas. El restablecimiento solo quita el cambio estructural (si el portal tiene un cosmético activo, se conserva). Los cambios forzados a mano (`/__fake/mutaciones/aplicar`) no se restablecen solos. Se revisa cada 15 s.
- Apagarlo (vuelve al comportamiento anterior: el estructural dura hasta resolverlo y manda el tope): `npm run bot:fake-portal -- --entrenar --sin-auto` o `BOT_FAKE_AUTO_RESTORE=0`.
- `BOT_FAKE_RESTORE_GRACE_MINUTES` (margen de gracia, 0–1440, por defecto 3) y `BOT_FAKE_MAX_LIFE_MINUTES` (vida máxima, 1–10080, por defecto 60).
- El servidor lee `BOT_INCIDENTS_DIR` del entorno o de `-- --incidentes <carpeta>` (el script `bot:fake-portal` no carga `.env.bot`: si cambió la carpeta de incidentes del robot, páselo así).

**Catálogo** (id · portales · qué paso del robot debe notarlo):

| Cambio | Portales | Debe notarlo |
|---|---|---|
| `renombrar_campo` (name/id del título) | los 5 | prueba de estructura y publicar; **ahora lo absorbe la tolerancia** (el campo se halla por su etiqueta): sale «absorbido (tolerado)» en el informe |
| `texto_boton` (botón de retirar y estado «cerrado») | todos menos Trabajos Diarios (su adaptador retira por POST) | retirar |
| `boton_en_menu` (botones tras «Más acciones») | los 5 | prueba de estructura y publicar |
| `paso_extra` (paso nuevo en el asistente) | linkedin, bumeran | prueba de estructura y publicar |
| `reordenar_pasos` (pasos 2 y 3 intercambiados) | linkedin, bumeran | prueba de estructura y publicar |
| `campo_obligatorio` (campo nuevo en el paso 1) | los 5 | publicar; además la prueba de estructura en linkedin, bumeran e indeed |
| `campo_a_lista` (ubicación pasa a lista desplegable) | los 5 | publicar |
| `aviso_cookies` (ventana que tapa el formulario) | los 5 | **ahora lo absorbe la tolerancia** (se acepta el aviso): «absorbido (tolerado)» en el informe |
| `paginacion_postulantes` (lista paginada con otras marcas) | los 5 | leer postulantes y la prueba de estructura (esta última solo si ya hay una oferta publicada) |
| `enlace_cv` (el enlace de descarga pasa a ser un botón con JavaScript) | los 5 | bajar el CV (solo al traer postulantes nuevos) |
| `cosmetico_colores`, `_tamanos`, `_tipografia`, `_espaciado`, `_orden_visual` | los 5 | **nada**: publicar y la prueba de estructura deben seguir bien |

Los cambios estructurales con «retirar», «leer postulantes» o «bajar el CV» no los ve la prueba de estructura: solo aparecen cuando el robot hace esa acción (un incidente `retirar`, `leer_postulantes` o `descargar_cv` con `pagina_cambio`, sin detener el portal). Es justo lo que el informe deja ver.

**Resolver o restablecer** (GET o POST; también hay enlaces en el panel `/`):
- `/__fake/modo?portal=X&restablecer=1`: vuelve al original y marca el cambio como `restablecida`.
- `/__fake/mutaciones/resolver?portal=X`: acepta el estado actual como **nuevo original** (para cuando el adaptador ya se corrigió) y marca el cambio como `resuelta`. Los siguientes «restablecer» vuelven a ese nuevo original.
- `/__fake/mutaciones/aplicar?portal=X&cambio=<id>`: fuerza un cambio (pruebas y demo; no respeta el tope).
- `/__fake/mutaciones`: el diario y el estado en JSON (próximo cambio, semilla, activos).
Con la reanudación automática del robot (abajo) no hace falta reiniciarlo tras un `pagina_cambio` una vez restablecido el cambio; con `BOT_RESUME_CHECK_MINUTES=0` sí (`npm run bot`).

**Diario** `bot/.state/mutaciones.json` (ignorado por git; escritura atómica): `id`, `timestamp`, `portal`, `mutacion`, `tipo`, `descripcion`, `esperado`, `estado` (`activa`/`resuelta`/`restablecida`), `resueltaEn`, `origen` y, si lo restableció el modo continuo, `restablecida_auto`, `motivo` y `restablecidaEn`. El panel `/` muestra el bloque «Entrenamiento»: cuenta atrás al próximo cambio, últimos cambios y estructurales sin resolver.

**Reanudación automática del robot.** Cuando un portal se detiene por `pagina_cambio` (la prueba de estructura falló), el robot ya no termina: cada `BOT_RESUME_CHECK_MINUTES` (10 por defecto; 0 = desactivado) ejecuta SOLO el `healthCheck()` de ese portal (sin efectos: no publica ni retira nada, no toca la cola). Si pasa, reanuda el portal, informa el estado `activo` a la app, avisa por el canal de avisos («X se reanudó: la prueba de estructura volvió a pasar»), anota en el incidente `recoveredAt`/`recoveryNote` (sigue «abierto»: la decisión es de la persona, pero un fallo posterior ya es un incidente nuevo) y lo deja en el log. Si falla, sigue detenido, sin avisos repetidos (el log lo anota una vez). Si la comprobación revela `sesion_expirada`, `verificacion_requerida` o `navegador_cerrado`, el portal pasa a exigir a una persona y se avisa. Un portal detenido por `sesion_expirada`, `verificacion_requerida`, `navegador_cerrado`, `api_no_disponible` o `fallos_seguidos` nunca se reanuda solo. El robot termina con código 2 solo cuando todos los portales están detenidos por esos motivos. Las comprobaciones corren en el mismo hilo que los ciclos (nunca a la vez, el navegador se comparte) y dentro del mismo proceso, que ya tiene el candado de instancia (`bot/.state/robot.lock`). La orden «estado» muestra los portales detenidos y las reanudaciones.

**Informe automático.** Mientras el entrenamiento está activo, el servidor de portales regenera cada `BOT_FAKE_REPORT_MINUTES` (1–1440, por defecto 15) el archivo `bot/.state/informe-entrenamiento.md` (escritura atómica) y lo expone en `/__fake/informe` (HTML; `?actualizar=1` lo regenera ahora). El bloque «Entrenamiento» del panel `/` lo enlaza y muestra la hora de la última generación y los totales (detectados, escapados, falsas alarmas, tiempo medio de detección, reanudaciones). Además de las tablas por cambio, el informe trae la tasa de detección y el tiempo medio **por tipo de cambio** y **por portal**, y una línea por cada reanudación automática (cuánto estuvo detenido el robot y cuánto tardó en volver desde que se restableció el portal).

**Informe por consola** (solo lectura): `npm run bot:training-report` cruza el diario con los incidentes y escribe en consola, por cada estructural, si fue detectado (hay un incidente del mismo portal creado después del cambio y antes del siguiente cambio de ese portal), el tiempo hasta detectarlo y el código; por cada cosmético, si hubo falsa alarma; y los totales (detectados, escapados, sin detectar aún, falsas alarmas). `-- --md [archivo]` lo guarda además en Markdown dentro de `bot/.state/` (por defecto `informe-entrenamiento.md`). `-- --cada <minutos>` lo repinta cada tanto (modo vigilancia). Un estructural sin incidente durante cuya ventana el robot usó selectores alternativos de ese portal (`bot/.state/tolerancias.json`, `-- --tolerancias <archivo>`) se clasifica **«absorbido (tolerado)»**, distinto de detectado y de escapado: tiene su columna «Tolerancias» (eventos y claves), el total «absorbidos (tolerados)» y la columna «Absorbidos» de las tablas por tipo y por portal (no entran en la tasa de detección). No incluye mensajes de incidentes ni datos personales. Limitación: si el mismo fallo sigue «abierto» en un incidente anterior, el robot lo cuenta como repetición (no crea otro); el informe lo marca «repetido» y el tiempo es una cota superior. Decida los incidentes (`sí N` / `no N`) para que los siguientes cambios generen incidentes nuevos.

**Configurar el robot para entrenar.** `BOT_HEALTH_CHECK_HOURS` acepta decimales (se comprobó en `config.ts` y en `createHealthSchedule`: `0.5` = 30 minutos). La prueba solo corre dentro de un ciclo, así que también hay que bajar `BOT_POLL_SECONDS`. Con un cambio cada 30 minutos se recomienda `BOT_HEALTH_CHECK_HOURS=0.25` (15 minutos) y `BOT_POLL_SECONDS=120`: el robot ve el cambio, como mucho, unos 15 a 17 minutos después. Con los valores por defecto (24 h y 10 min) casi todo quedaría «escapado». **Recomendado para entrenar en modo continuo:** `BOT_HEALTH_CHECK_HOURS=0.25`, `BOT_POLL_SECONDS=120` y `BOT_RESUME_CHECK_MINUTES=5` (el robot reanuda un portal restablecido a los pocos minutos). Se ponen en el entorno o en su `.env.bot` (este encargo no lo edita).

## Escribir el adaptador de un portal real

Implemente `PortalAdapter` (`bot/src/types.ts`) en `bot/src/adapters/<portal>.ts` y regístrelo en `bot/src/adapters/index.ts`; `bot/src/adapters/fake.ts` (una pantalla) y `fake-linkedin.ts` (asistente de varios pasos) sirven de modelo; `fake-base.ts` reúne solo lo común (pestaña propia, sesión/CAPTCHA, descarga de CV), no los selectores. El adaptador solo navega el portal: lanza `PortalError` con un código de `bot/src/errors.ts` y deja que el runner informe. El `slug` debe existir en `PORTAL_NAMES` de `src/modules/portal-bot/auth.ts`.

Antes de escribirlo hacen falta, de la cuenta de empresa real: capturas o HTML guardado de la pantalla de publicar, de la lista de postulantes y de la descarga de CV, y la autorización por escrito de la empresa (y, de preferencia, del portal). No se inventan selectores.

Reutilice una sola pestaña para todas las operaciones (como `withPage` en `fake-base.ts`, que además reparte una pestaña distinta a cada adaptador cuando comparten navegador) en vez de abrir y cerrar una por oferta: se nota menos y carga menos al portal.

Para que los incidentes lleven el esquema de la pantalla, implemente `captureStructure()` con `captureStructure(page)` de `bot/src/structure.ts` (los `fake-*` lo heredan de `fake-base.ts` y lo capturan en la pantalla donde falló). Para buscar cada elemento declare un **libro de selectores** (`registerBook(slug, {...})` de `bot/src/selectors.ts`) y use `resolveElement(page, slug, "clave")`, que envuelve `findElement` de `bot/src/locate.ts`: override aprobado → selector por defecto → alternativas (rol, etiqueta, texto, sinónimos) si la entrada no es estricta, y deja constancia cuando solo funcionó una alternativa. Marque `estricto(...)` el botón de enviar/publicar y el de retirar. Cada adaptador declara sus propios selectores; nunca se inventan.

Dos trampas que ya aparecieron con el portal falso: (1) el código que se pasa a `evaluate`/`evaluateAll` corre en el navegador y no debe declarar funciones con nombre (con `tsx` falla con `__name is not defined`); (2) esperar con `waitFor()` una tabla vacía agota el tiempo porque Playwright la considera oculta: use `{ state: "attached" }`. Pruebe cada adaptador también con `npm run bot`, no solo con vitest.
