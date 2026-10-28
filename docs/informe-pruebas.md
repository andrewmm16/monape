# Informe de pruebas ejecutadas · Etapa 1

**Fecha de ejecución:** 22/10/2026 · **Entorno:** Windows 11, Node.js 24.22.1 (portable), sin Docker · **Datos:** exclusivamente ficticios, generados por las propias pruebas.

Este informe recoge solo pruebas **realmente ejecutadas**. Lo que no se pudo ejecutar figura en la sección 5.

## 1. Resumen

| Suite | Comando | Resultado |
|---|---|---|
| Unitarias (lógica pura) | `npm run test:unit` | ✅ 65/65 |
| Autorización en el servidor (Server Actions y rutas) | `npm run test:unit` | ✅ 26/26 |
| Base de datos: migraciones, RLS, reglas de negocio, coherencia TS↔SQL | `npm run test:db` | ✅ 56/56 |
| **Total Vitest** | `npm test` | ✅ **147/147** en 11 archivos |
| E2E Playwright sin backend (escritorio + móvil) | `npm run test:e2e` | ✅ **30/30**; 4 omitidas (requieren Supabase) |
| Secretos en el código del navegador | `npm run test:secrets` | ✅ 40 archivos, 0 coincidencias; control negativo detecta la fuga |
| Tipos | `npm run typecheck` | ✅ sin errores |
| Lint | `npm run lint` | ✅ sin errores ni advertencias |
| Compilación de producción | `npm run build` | ✅ 18 rutas, todas dinámicas |

## 2. Pruebas de base de datos (PGlite)

Se aplican las 5 migraciones sobre **PostgreSQL 18.6 (PGlite)** precedidas de `tests/db/supabase-shim.sql`, una réplica mínima de lo que Supabase provee (roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`, `storage.buckets`/`objects`, `storage.foldername()` y los privilegios por defecto del esquema `public`). Las consultas se ejecutan con `SET ROLE` y el JWT simulado, por lo que **RLS se evalúa de verdad**.

`tests/db/migrations.test.ts` (6): las migraciones se aplican en orden; todas las tablas tienen RLS; `anon` no tiene privilegios sobre tablas, vistas ni funciones; las vistas usan `security_invoker`; toda función `SECURITY DEFINER` fija `search_path` vacío; el bucket es privado y limita tamaño/tipos.

`tests/db/rls.test.ts` (23):
- Usuario no autenticado: no consulta tablas privadas, no ejecuta funciones, no ve archivos.
- Evaluador: solo ve sus vacantes, candidatos, CV y archivos; un evaluador sin vacantes no ve CV; no puede cambiar roles (ni el propio), crear vacantes/candidatos, registrar o revisar evaluaciones, cambiar estados, insertar evaluaciones directamente, subir ni borrar archivos; solo puede registrar observaciones en postulaciones a las que tiene acceso y no puede falsificar otros tipos de evento.
- RRHH: ve todo el proceso; no puede cambiar `status` sin la función auditada; no puede autopromoverse; no ve ni borra la auditoría; no lee, sube ni borra archivos del bucket con su sesión (lo hace el servidor); no inserta CV ni extracciones fuera de la función de registro; no borra CV.
- Nadie (ni evaluadores ni RRHH) accede a los archivos del bucket directamente.
- Usuario desactivado: pierde acceso (solo ve su propio perfil).
- Administración: la auditoría guarda campos modificados sin valores personales; no se puede dejar el sistema sin administradores activos; nadie modifica la auditoría.

`tests/db/business-rules.test.ts` (26): aprobación de criterios versionada y anulada al cambiar requisitos; RRHH no puede aprobar por escritura directa; registro de evaluación vinculado a la versión de criterios, con copia de requisitos, **sin cambiar el estado del proceso**; rechazo de porcentajes manipulados, de evaluaciones incompletas, de versiones desactualizadas y de criterios no aprobados; evaluaciones inmutables con revisión humana registrada; historial de estados con responsable y motivo obligatorio; vacantes cerradas no admiten postulaciones; vacantes con postulaciones no se eliminan; versionado de CV con registro atómico de su extracción (si la extracción falla, no queda el CV); rutas de almacenamiento validadas; detección de duplicados; verificación de datos registra al verificador; resumen del panel restringido al ámbito del evaluador; límite de solicitudes con máximos fijados en la base de datos (quien llama no puede elegirlos ni inventar operaciones). Regresiones de la revisión independiente: revisión única de evaluaciones (no se pierden observaciones), nivel incoherente rechazado, ciclo de vida de la vacante en la base de datos, vacantes archivadas sin cambios de estado ni aprobación, postulaciones sin borrado, responsable de evaluación del equipo de la vacante, CV de origen del mismo candidato, auditoría de descargas solo para CV accesibles y sin función genérica de auditoría.

`tests/db/scoring-consistency.test.ts` (1): 60 combinaciones aleatorias reproducibles de pesos, prioridades y valoraciones calculadas con `scoring.ts` y registradas con `record_evaluation` sin discrepancias; cubren los cuatro niveles.

## 3. Pruebas unitarias

- `scoring.test.ts` (9): fórmula ponderada, redondeo igual al de la base de datos, niveles (falta de información ≠ incompatibilidad; obligatorio no cumplido impide «alta»), reproducibilidad, cobertura exacta de requisitos.
- `rule-engine.test.ts` (14): búsqueda sin tildes/mayúsculas/espacios, límites de palabra, `C#` y `.NET`, evidencia literal con posición exacta en el CV, «sin evidencia» en lugar de «no cumplido», el motor nunca produce «no cumplido», requisitos sin términos, competencias y requisitos esenciales pendientes de verificación, años mínimos solo con menciones de «años de experiencia» (no la edad ni la antigüedad de una empresa) y tomando la mención más cercana, determinismo.
- `ai.test.ts` (9): respuestas del modelo inválidas rechazadas; citas inventadas descartadas; afirmaciones sin evidencia rebajadas; requisitos omitidos/desconocidos; requisitos esenciales nunca acreditados automáticamente; redacción de datos de contacto conservando años; prompt con prohibición de características protegidas y defensa ante instrucciones dentro del CV; IA bloqueada sin aprobación expresa o sin clave.
- `resumes.test.ts` (17): validación de PDF/DOCX (extensión, doble extensión, tipo declarado, firma real, vacío/incompleto/>4 MB), PDF con JavaScript (también ofuscado), DOCX con macros, objetos incrustados o plantillas remotas, *zip bomb* de 40 entradas superpuestas abortada en menos de 3 s, 100 PDF con imagen binaria aleatoria sin falsos positivos, ZIP que no es Word, limpieza de nombres; extracción real de PDF y DOCX (incluido encabezado), PDF sin texto marcado «sin texto» sin inventar datos, documento dañado informado sin excepción; sugerencias sin inventar datos ni confundir años con teléfonos.
- `drafts.test.ts` (9): borradores de observación y de motivo de «No seleccionado» generados a partir de la evaluación. Separan requisitos obligatorios y deseables; expresan «sin evidencia» como ausencia de mención, nunca como incumplimiento; presentan lo «aparentemente no cumplido» como algo por confirmar; advierten si la evaluación usó criterios anteriores; si no hay brechas obligatorias, el motivo lo dice y queda para que lo complete RRHH; el motivo nunca supera los 500 caracteres y el formulario de cambio de estado lo acepta. Además se comprobó en la aplicación (Chromium, sin guardar) que ambos botones insertan el borrador en el campo correcto.
- `security-helpers.test.ts` (7): matriz de permisos por rol, redirecciones seguras (rechaza dominios externos, `//`, `\`, `javascript:`, rutas no permitidas), errores de base de datos sin detalles internos.
- `server-authorization.test.ts` (26): con un cliente Supabase simulado que registra cada operación, se verifica que **12 acciones administrativas** devuelven «sin permisos» a un evaluador sin ejecutar escrituras, RPC, subidas ni el cliente con clave secreta; RRHH no gestiona usuarios; entradas inválidas y archivos inválidos se rechazan antes de la base de datos/almacenamiento; sesiones ausentes o cuentas desactivadas no operan; no se revisa una evaluación con el identificador de otra postulación; la descarga de CV responde 401/404/400 sin generar URL firmada y, con acceso, ejecuta límite → auditoría → URL firmada de 60 s en ese orden; una cuenta desactivada con sesión vigente se cierra sin bucles y una activa no puede ser desconectada por esa ruta.

## 4. Pruebas E2E (Playwright, Chromium escritorio y Pixel 7)

Contra `next start` (build de producción) con configuración de Supabase ficticia (`tests/e2e/publico.spec.ts`, 15 casos × 2 dispositivos):
- 5 rutas privadas redirigen a `/ingresar` conservando el destino.
- Descarga de CV sin sesión → 401 con `Cache-Control: no-store`.
- Ruta de cuenta desactivada sin sesión → ingreso, sin efectos.
- Enlace de confirmación inválido con `next` externo → no redirige fuera.
- CSP con nonce y `strict-dynamic`, sin `unsafe-eval` en producción, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, sin `X-Powered-By`.
- La aplicación funciona con la CSP activa (sin violaciones en consola).
- Sin enlace de registro público; validación en el servidor del ingreso (y el correo se conserva tras el error); servicio de autenticación caído se informa sin aparentar éxito; recuperación de contraseña con respuesta idéntica exista o no la cuenta; sin desplazamiento horizontal en móvil.

## 4 bis. Ejecución contra Supabase local (Docker) · 22/10/2026

Más tarde, el mismo día, se comprobó que Docker Desktop estaba disponible y se levantó el stack oficial con `npx supabase start` (CLI 2.121.0, PostgreSQL **17.11**, Auth, PostgREST y Storage reales).

| Prueba | Resultado |
|---|---|
| Aplicación de las 5 migraciones (`supabase start` y dos `supabase db reset`) | ✅ sin errores |
| `npm run db:seed` (usuarios en Auth, vacantes, CV subidos al bucket privado y extraídos) | ✅ tras corregir el defecto 2 |
| Registro público bloqueado (`POST /auth/v1/signup`) | ✅ `422 signup_disabled` |
| `tests/e2e/flujo-rrhh.spec.ts` (escritorio): flujo completo de RRHH y restricciones del evaluador | ✅ **2/2** tras corregir los defectos 1–3 |
| `npm test` / `npm run lint` / E2E públicas / `test:secrets` con la clave secreta real cargada | ✅ 138/138 · sin errores · 30/30 · 0 valores secretos en 40 archivos |

Defectos encontrados y corregidos:

1. **No se podía iniciar sesión.** En `supabase/config.toml`, `[auth.email] enable_signup = false` desactiva el proveedor de correo completo (también el inicio de sesión), no solo el registro. Se dejó en `true`; el registro público lo bloquea `[auth] enable_signup = false` (verificado). Además, `signIn` mostraba ese error de configuración como «Correo o contraseña incorrectos»; ahora se registra en el servidor y se informa como servicio no disponible (`src/modules/auth/actions.ts`).
2. **Los usuarios ficticios quedaban todos como `evaluador`.** Supabase Auth guarda `app_metadata` después de insertar el usuario, así que el trigger `handle_new_user` no ve el rol. El script ahora fija el rol en `profiles` (`scripts/seed-dev.ts`). La invitación desde la aplicación no tenía este problema: ya asigna el rol actualizando `profiles`.
3. **Selectores ambiguos en la prueba E2E** (`Requisito` y `Cargar` coincidían con varios elementos). Se acotaron en `tests/e2e/flujo-rrhh.spec.ts`.

## 4 ter. Una postulación en proceso y papelera de usuarios · 23/10/2026

Cambios: migraciones `20261023000100_one_active_application.sql` y `20261023000200_user_trash.sql`.

| Prueba | Resultado |
|---|---|
| `npm test` (incluye 7 pruebas nuevas en PGlite: regla de postulación, vacante archivada, casos previos a la regla, fecha de desactivación, `log_user_deletion`, perfil histórico, último administrador; y `deleteUser` en la autorización del servidor) | ✅ **155/155** en 12 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` | ✅ sin errores · 19 rutas · 0 valores secretos en 41 archivos |
| `npx supabase migration up --local` sobre el stack con datos (sin `db reset`) | ✅ ambas migraciones aplicadas |
| Script contra Supabase local con la Admin API real de Auth: un usuario activo no se elimina; RRHH no puede pedir la eliminación; borrar la cuenta deja el perfil histórico sin correo; queda auditado quién la pidió; no se puede reactivar; el correo queda libre; se rechaza una segunda postulación en proceso de un candidato del seed | ✅ 10/10 |
| `tests/e2e/flujo-rrhh.spec.ts` (escritorio) contra Supabase local, con el flujo nuevo de papelera (invitar, desactivar, reactivar, eliminar) | ✅ **3/3** |
| E2E públicas (escritorio + móvil) | ✅ 30/30 |

## 4 quater. Estado sugerido, «Pedir opinión» con notificaciones y aviso de duplicados · 23/10/2026

Cambios: migración `20261023000300_opinion_requests.sql`, `src/modules/evaluation/drafts.ts`, formulario de estado, campana de notificaciones y ventana emergente de duplicados.

| Prueba | Resultado |
|---|---|
| `npm test` (nuevas: `tests/unit/drafts.test.ts` reescrita, con estado sugerido, motivo para cada estado, siguiente paso y avisos de coherencia; `tests/db/opinion-requests.test.ts`; `requestOpinion` en la autorización del servidor) | ✅ **170/170** en 13 archivos |
| `npm run typecheck` / `lint` / `build` | ✅ sin errores |
| `npx supabase migration up --local` | ✅ migración aplicada sobre datos existentes |
| `tests/e2e/flujo-rrhh.spec.ts` (escritorio) contra Supabase local: estado «Preseleccionado» sugerido con motivo y observación; el botón de sugerir no repite el texto; ventana emergente de duplicado; RRHH pide opinión, la persona consultada ve la campana y el aviso, responde con una observación y RRHH recibe la notificación; papelera | ✅ **4/4** |
| E2E públicas (escritorio + móvil) / `test:secrets` | ✅ 30/30 · 0 valores secretos en 42 archivos |

Después, migración `20261023000400_opinion_any_evaluator.sql` (pedir opinión a un evaluador fuera del equipo, que se agrega al equipo con confirmación):

| Prueba | Resultado |
|---|---|
| `npm test` (nuevas en PGlite: evaluador fuera del equipo, rechazado sin confirmación y agregado con ella; la notificación solo la lee la persona consultada, no quien la pidió, ni administración, ni el resto del equipo, ni una cuenta desactivada) | ✅ **172/172** |
| `tests/e2e/flujo-rrhh.spec.ts` contra Supabase local: RRHH pide la opinión del evaluador (fuera del equipo, con confirmación); solo él recibe la notificación (administración y RRHH no la ven); al responder, RRHH recibe la suya | ✅ **4/4** tras corregir el defecto siguiente |
| E2E públicas (escritorio + móvil) | ✅ 30/30 |

Defecto encontrado por la E2E: el aviso amarillo aparecía arriba a la derecha, encima de la campana, y no dejaba pulsarla durante 12 s. Ahora todos los avisos se muestran debajo del encabezado (`offset` del `Toaster` en `src/app/layout.tsx`).

## 4 quinquies. Eliminación del rol evaluador · 23/10/2026

Decisión de RRHH. Antes se eliminó la única cuenta de evaluador del stack local por el camino de la papelera (desactivar → `log_user_deletion` → Admin API de Auth). Después se aplicó la migración `20261023000500_remove_evaluator_role.sql`.

| Prueba | Resultado |
|---|---|
| `npx supabase migration up --local` | ✅ Tipo `app_role` = `{admin,rrhh}`, tabla `vacancy_members` eliminada, perfiles eliminados con rol evaluador sin rol (nombre conservado) |
| `npm test`: se retiraron las pruebas propias del evaluador. Se añadieron: las 15 acciones del servidor rechazadas con la cuenta desactivada, panel vacío para una cuenta desactivada, opinión solo a personas con cuenta activa y notificaciones visibles solo para su destinatario | ✅ **163/163** en 13 archivos |
| `npm run typecheck` / `lint` / `build` | ✅ sin errores |
| `tests/e2e/flujo-rrhh.spec.ts` (escritorio) contra Supabase local: flujo de RRHH, pedir opinión (solo la persona consultada recibe la notificación), RRHH sin acceso a Usuarios, papelera | ✅ **4/4** |
| E2E públicas (escritorio + móvil, sin backend) | ✅ 30/30 |

Las pruebas de RLS que verificaban el aislamiento del evaluador por vacante ya no existen. Si el rol se reimplementa, habrá que escribirlas de nuevo: el código anterior no está en git.

## 4 sexies. Cierre de sesión por inactividad · 26/10/2026

Decisión de RRHH: la sesión se cierra tras 30 min sin actividad. A los 29 min aparece «¿Sigue ahí?» con una cuenta regresiva de 60 s. El servidor también cierra la sesión si la pestaña o el navegador se cerraron (cookie `ultima-actividad`, firmada con HMAC y ligada al usuario). Diseño en `src/lib/auth/inactivity.ts`.

| Prueba | Resultado |
|---|---|
| `npm run test:unit`: límites del servidor, tolerancia de reloj, cookie auténtica, editada, de otro usuario o mal formada | ✅ **109/109** en 8 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` con `.env.local` cargado | ✅ sin errores · 0 valores secretos en 42 archivos |
| `tests/e2e/inactividad.spec.ts` (escritorio + móvil) contra Supabase local, con el reloj simulado de Playwright: sin aviso a los 28:30; aviso a los 29:15; mover el mouse con el aviso abierto no lo cierra; «Seguir conectado» reinicia el conteo; a los 30 min redirige a `/ingresar?motivo=inactividad` y la sesión queda cerrada en el servidor. Una cookie editada desde el navegador o ausente cierra la sesión (página y API) | ✅ **4/4** |
| E2E públicas (escritorio + móvil, sin backend) | ✅ 30/30 |

Revisión independiente: se corrigieron la cookie sin firmar (se podía editar para reabrir una sesión vencida), un posible bucle de redirecciones si el cierre fallaba en el proxy, un clic al volver de una suspensión que reabría la sesión en el navegador y la falta de `Cache-Control: no-store` en las redirecciones con cookies.

Límites conocidos:
- Con la pestaña cerrada, el servidor cierra la sesión a los 32 min. El margen de 2 min existe porque el navegador informa la actividad una vez por minuto. Si el usuario vuelve entre los 30 y los 32 min, la página se carga y el navegador cierra la sesión en un segundo.
- Las sesiones abiertas antes de este cambio se cierran una vez, porque no tienen la cookie.
- El botón «Cerrar sesión» del aviso, igual que el del menú, cierra la sesión en todos los dispositivos. El cierre por inactividad solo cierra la de ese navegador.

## 4 septies. Portales, carga masiva de CV y bandeja de entrada (paquete 2.3) · 27/10/2026

Migraciones `20261027000100_intake.sql` y `20261027000200_intake_hardening.sql`, aplicadas a Supabase local con `npx supabase migration up --local`.

| Prueba | Resultado |
|---|---|
| `npm run test:unit`: sugerencia de nombre, orden de subida y compensación del archivo (también si el registro se confirmó sin respuesta o si el lote se cerró), descarte, cierre y autorización de cada acción | ✅ **146/146** en 10 archivos |
| `npm run test:db` (PGlite): registro atómico, sin doble registro, columnas protegidas, cierre solo por función, sin reapertura, ruta de archivo exacta, borrar el candidato borra el ítem sin dejar correo ni teléfono, duplicados por correo y SHA-256, límite `cv_bulk_upload`, `anon` sin privilegios | ✅ **82/82** en 7 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` con `.env.local` cargado | ✅ sin errores · 0 valores secretos en 44 archivos |
| `tests/e2e/carga-masiva.spec.ts` (escritorio) contra Supabase local real, incluido Storage: lote de 3 archivos con uno inválido, que no detiene al resto; corrección de nombre, correo y teléfono pasando con Tab sin perder lo escrito; registro de 2 con evaluación por reglas; las postulaciones aparecen en la vacante y en la bandeja con «Computrabajo · Carga masiva»; una página inexistente de la bandeja no falla; cerrar el lote borra lo pendiente | ✅ **1/1** |
| Regresión: `flujo-rrhh.spec.ts` (con administración), `inactividad.spec.ts` y E2E públicas | ✅ 4/4 · 4/4 · 30/30 |
| Revisión visual (escritorio y Pixel 7) de la carga masiva y la bandeja | ✅ La bandeja no desborda en móvil. La tabla de revisión se desplaza dentro de su contenedor |

**Revisión independiente:** no encontró escalada de privilegios. Se corrigieron:
- el correo, el teléfono y las sugerencias quedaban copiados en el ítem del lote aunque se eliminara al candidato;
- la fila de revisión descartaba lo que RRHH escribía al pasar con Tab;
- la compensación podía dejar un CV sin archivo si se perdía la respuesta tras confirmar el registro;
- había una carrera entre cerrar el lote y subir archivos;
- un lote se podía cerrar o reabrir por la API sin limpiar sus archivos;
- la ruta temporal del archivo no estaba ligada al lote ni al ítem;
- la bandeja fallaba con una página fuera de rango.

**Pendiente:**
- la carrera entre cierre y subida está cubierta por diseño (un mismo candado), pero no tiene una prueba concurrente;
- la carga masiva no se probó con un archivo real de 4 MB.

## 4 octies. Páginas públicas, datos para Google y feed (paquete 2.9) · 27/10/2026

Migraciones `20261028000100_public_jobs.sql` y `20261028000200_public_jobs_fixes.sql`, aplicadas a Supabase local.

| Prueba | Resultado |
|---|---|
| `npm run test:unit`: JSON-LD (campos de Google, remoto, sueldo, escape de `</script>`), feed (escape, CDATA, vencidas), dirección pública, `robots.txt`, esquema del formulario de vacante (montos, sueldo incompleto, confidencial) | ✅ **176/176** en 13 archivos |
| `npm run test:db` (PGlite): funciones públicas solo para `service_role`; se excluyen las vacantes confidenciales, en borrador, archivadas y vencidas; los requisitos no exponen términos ni pesos; publicar sin datos falla; código inmutable; las vacantes publicadas antes de la migración reciben su código; `anon` sin privilegios | ✅ **98/98** en 8 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` | ✅ sin errores · 0 valores secretos en 44 archivos |
| `tests/e2e/empleos.spec.ts` contra Supabase local con la parte pública encendida: publicar → listado, página con JSON-LD y feed; la confidencial no aparece; al cerrar sale del listado y del feed y la página muestra el aviso; el feed y `/empleos` no envían cookies, ni siquiera con sesión iniciada; las direcciones inexistentes responden 404 | ✅ **3/3** (escritorio y móvil) |
| E2E públicas sin backend: con la parte pública apagada, `/empleos`, el feed y las vacantes responden 404, `robots.txt` bloquea todo y el sitemap queda vacío; `/empleosx` sigue siendo privada | ✅ **36/36** |
| Regresión con backend: `flujo-rrhh` (ahora publica con los datos públicos), `carga-masiva` e `inactividad` | ✅ 4/4 · 1/1 · 4/4 |
| Servidor de producción en el puerto 3000: `/empleos` responde 200; el feed lleva `Cache-Control: public, max-age=300, s-maxage=300` y ningún `Set-Cookie` | ✅ |
| Revisión visual (escritorio y Pixel 7) del listado, la página de la vacante y el formulario | ✅ Sin desplazamiento horizontal |

**Revisión independiente:** no encontró exposición de datos internos. Se corrigieron:
- el formulario rechazaba cualquier sueldo, porque la expresión regular había perdido sus barras invertidas;
- las vacantes publicadas antes de la migración nunca recibían su dirección pública;
- `robots.txt` bloqueaba el CSS y el JS que Google necesita para mostrar la página;
- las respuestas cacheables podían llevar cookies de sesión: ahora las rutas públicas no gestionan la sesión.

Además, «Publicar internamente» pasó a «Publicar».

**Sin verificar:**
- la validación de Google (herramienta de resultados enriquecidos), que necesita un dominio público;
- que Jooble, Trovit, Careerjet y los demás acepten el formato del feed (es el de Talent.com).

## 4 nonies. Recepción de Talent Apply (paquete 2.10) · 27/10/2026

Migración `20261028000300_talent_apply.sql`, aplicada a Supabase local. Configuración y limitaciones en [configuracion-talent.md](configuracion-talent.md).

| Prueba | Resultado |
|---|---|
| `npm run test:unit`: esquema de la carga (descarta IP, navegador y preguntas; teléfono como texto o número), base64 con y sin prefijo e inválido, clave por vacante y comparación, feed con `<talent-apply-data>` y URL codificada, códigos HTTP (solo la vacante cerrada da 410) | ✅ **202/202** en 14 archivos |
| `npm run test:db` (PGlite): funciones nuevas solo para `service_role`; idempotencia por identificador; rechazo de vacantes cerradas, confidenciales y vencidas; motivos de duplicado; actor nulo en evento, auditoría y evaluación; `record_evaluation` y `register_resume` siguen exigiendo personal; sin columnas de IP ni de navegador; `anon` sin privilegios; las pruebas de puntuación anteriores siguen pasando | ✅ **120/120** en 9 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` | ✅ sin errores · 0 valores secretos en 44 archivos (incluidos los dos secretos nuevos) |
| `tests/e2e/talent-apply.spec.ts` contra Supabase local, con envíos simulados: el feed privado trae `talent-apply-data`; la postulación aparece en la bandeja con «Talent.com · Integración» y evaluada; repetir el mismo identificador no la duplica; claves incorrectas del envío y del feed responden 404 | ✅ **1/1** (escritorio), repetida tras las correcciones |
| Regresión con backend: `empleos`, `carga-masiva` y `flujo-rrhh` | ✅ 2/2 · 1/1 · 4/4 |
| E2E públicas sin backend | ✅ **36/36**, tras apagar explícitamente la parte pública en esa configuración, porque `.env.local` ahora la enciende |

Las E2E se ejecutaron en el puerto 3200, porque el 3100 lo ocupa otro proyecto del equipo.

**Revisión independiente:** aprobado con observaciones, sin fallos de seguridad bloqueantes. Se corrigieron:
- si el registro se confirmaba pero se perdía la respuesta, se borraba el CV ya registrado: ahora se comprueba antes de borrar;
- cualquier conflicto de la base de datos respondía 410 («vacante cerrada»): ahora solo la vacante cerrada o vencida da 410 y el resto, 500;
- un teléfono enviado como número rechazaba la postulación: ahora se acepta, y los rechazos por datos inválidos quedan anotados;
- el feed privado con la configuración incompleta devolvía el error por defecto de Next.js: ahora responde 500 sin detalles.

**Riesgos aceptados:** archivo huérfano si el servidor se cae entre guardar el CV y registrar la postulación; las claves van en la dirección y pueden quedar en los registros de acceso del alojamiento.

**Sin verificar:**
- el envío real de Talent.com: codificación del CV, respuesta esperada y reintentos;
- el costo y la cobertura en Perú;
- el límite real de tamaño en Vercel.

## 4 decies. Aviso de privacidad, constancias y formulario público de postulación (paquetes 2.1 y 2.2) · 27/10/2026

Migraciones `20261028000400_privacy_notices.sql`, `20261028000500_online_applications.sql` y `20261028000600_online_apply_hardening.sql`, aplicadas a Supabase local.

| Prueba | Resultado |
|---|---|
| `npm run test:unit`: prueba de trabajo (firma, vencimiento, antigüedad mínima, bits, vacante), huella de la IP (IPv6 agrupada por /64, sin IP en claro), orden de la acción, campo trampa, respuesta idéntica ante duplicados, origen, `directApply`, autorización de los avisos, extracción aislada (plazo, memoria, pila, salida sin respuesta) y límite de 2 extracciones simultáneas | ✅ **260/260** en 16 archivos; repetida 5 veces sin fallos tras subir el tiempo por prueba a 20 s |
| `npm run test:db` (PGlite): una sola versión vigente e inmutable; activar exige referencia y retira la anterior; solo administración gestiona avisos; constancias solo por funciones; revocación sin borrar; funciones públicas solo para `service_role`; rechazo de vacantes cerradas, confidenciales, en borrador o vencidas y de avisos no vigentes; registro atómico; dos constancias por postulación; motivos de duplicado; límites por conexión, vacante y total, con purga; desafío de un solo uso; regresión de Talent Apply; `anon` sin privilegios | ✅ **170/170** en 11 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` | ✅ sin errores · 0 valores secretos en 47 archivos |
| `tests/e2e/postulacion.spec.ts` contra Supabase local: envío sin sesión con la referencia; la postulación aparece en la bandeja como «Página de empleos · Formulario en línea», evaluada y con referencia; repetir con el mismo correo da la misma respuesta y queda marcada «Posible duplicado»; archivo inválido; convocatoria cerrada sin formulario; sin cookies; enlace al aviso fijado a la versión | ✅ escritorio y móvil (Pixel 7, sin desplazamiento horizontal), repetida tras las correcciones de la revisión |
| `tests/e2e/privacidad.spec.ts`: administración crea y activa un aviso y la página pública lo muestra; RRHH no ve «Configuración» | ✅ **2/2** |
| Regresión con backend: `empleos`, `talent-apply`, `carga-masiva` y `flujo-rrhh` | ✅ sin fallos |
| E2E públicas sin backend: el formulario, el desafío y el aviso responden 404 con la función apagada | ✅ **40/40** |
| Revisión visual del formulario en móvil | ✅ Un solo paso, sin desbordes |

**Revisión independiente:** aprobado con observaciones. No encontró ninguna vía de escritura sin sesión que se salte el desafío, el límite o la validación, ni fugas de datos personales. Se corrigieron:
- los envíos con errores gastaban el cupo por conexión: ahora las comprobaciones baratas van antes del límite, y el límite subió de 5 a 20 por hora, a revisar con el negocio;
- el enlace al aviso no estaba fijado a la versión aceptada;
- si fallaba la consulta del aviso, se caía la página de la vacante;
- no había tope de extracciones simultáneas;
- la purga de los datos derivados de la IP no era determinista;
- faltaba compensar el archivo si la RPC lanzaba una excepción;
- las IPv6 no se agrupaban por /64.

**Riesgos aceptados y pendientes:** ver los puntos 15 y 16 de [pendientes.md](pendientes.md) y el checklist de [despliegue.md](despliegue.md): el worker en Vercel, `x-forwarded-for` detrás de otro proxy y el barrido de huérfanos.

**Sin verificar:** nada de esto se ha probado en internet. El texto del aviso es un borrador sin aprobación legal.

## 4 undecies. «Evaluar pendientes» y lectura local de CV escaneados (OCR) · 28/10/2026

Migraciones `20261028000700_evaluation_bulk.sql` (límite `evaluation_bulk`, 40 llamadas cada 10 min) y `20261028000800_resume_ocr.sql` (método `pdf_ocr`, límite `cv_ocr` de 20 cada 10 min y función `apply_resume_ocr`), aplicadas a Supabase local. Dependencias nuevas, con versión exacta: `tesseract.js` 7.0.0, `@tesseract.js-data/spa` 1.0.0 y `@napi-rs/canvas` 1.0.13.

**Prueba de concepto del OCR** (esta PC, Node 24, una página A4 a 300 dpi):

| Medida | Valor |
|---|---|
| Renderizado de la página | 836 ms |
| Arranque del motor | 436 ms |
| Reconocimiento | 1584 ms |
| CV de 4 páginas, completo | ≈ 8 s |
| Memoria máxima del proceso | 349 MB |
| Conexiones de red | 0, con las de red bloqueadas en el hilo principal |

El modelo de español lee mal la arroba (`@`), así que el correo no se propone.

| Prueba | Resultado |
|---|---|
| `npm run test:unit`: orden y respaldo de motores, escala de renderizado, mapeo de resultados, OCR real de un PDF escaneado generado (texto ficticio), OCR en `after()` del formulario, y «Evaluar pendientes» con mocks: cursor sin saltos, 1 OCR por llamada, ventana de 2 s, cola de 5 s, límite `cv_ocr`, CV transcrito durante el OCR y mensajes del botón manual | ✅ **288/288** en 18 archivos (repetida por el coordinador) |
| `npm run test:db` (PGlite): bucket `evaluation_bulk` (la llamada 41 se corta), `apply_resume_ocr` (autorización, nunca pisa una transcripción de RRHH, estados admitidos) y bucket `cv_ocr` | ✅ **181/181** en 12 archivos. Una corrida intermedia dio «11 failed» sin mensaje; las tres siguientes pasaron. No se pudo reproducir |
| `npm run typecheck` / `lint` / `build` / `test:secrets` | ✅ sin errores · 0 valores secretos en 48 archivos |
| Rastreo de archivos del build (`.nft.json`) | ✅ las rutas con OCR incluyen los datos de español, los `.wasm` y el binario de `@napi-rs/canvas` |
| `tests/e2e/evaluar-pendientes.spec.ts`: con criterios sin aprobar solo hay aviso; al aprobarlos, «Evaluar pendientes (3)» evalúa las tres, la lista queda de mayor a menor, el resumen sobrevive a recargar y el botón desaparece | ✅ escritorio |
| `tests/e2e/ocr-escaneado.spec.ts`: carga masiva de un PDF escaneado generado; la fila muestra el nombre propuesto y el aviso de OCR | ✅ escritorio |
| Regresión: `carga-masiva`, `postulacion` (escritorio y móvil) y `talent-apply` | ✅ sin fallos |
| Revisión independiente | Sin hallazgos bloqueantes. Se corrigieron la duración del OCR dentro del lote, los semáforos por proceso, el límite `cv_ocr` en el lote, el reintento tras una transcripción concurrente, los mensajes y los registros. Quedan aceptados el punto 17 de [pendientes.md](pendientes.md) y una carrera improbable al vencer el plazo mientras arranca el motor |

No probado:
- la vista en celular de ambas funciones;
- el OCR en `after()` del formulario y de Talent.com, y el botón «Leer escaneo automáticamente», salvo con pruebas unitarias;
- escaneos reales (fotos, ruido, baja resolución);
- dos OCR simultáneos;
- todo lo propio de Vercel (ver [despliegue.md](despliegue.md)).

## 4 duodecies. Años de experiencia por fechas («reglas-v2») y sugerencia de términos · 28/10/2026

Sin migraciones para el motor. La migración `20261028000900_resume_ocr_keep_text.sql` corrige un error del OCR detectado durante estas pruebas: si el OCR no encontraba texto útil, borraba el poco texto digital que tenía el PDF.

| Prueba | Resultado |
|---|---|
| `npm run test:unit`, años de experiencia por fechas: secciones de experiencia y de cierre (35 variantes, incluidas «Estudios realizados» y «Formación profesional»), subtítulos dentro del empleo («Funciones:», «Logros:», «Herramientas: SAP», «Tecnologías: React»), formatos de fecha (numéricos, con día, meses en español e inglés, «setiembre», año solo, «actualidad»), cotas con año solo, solapamientos, límite de 12 líneas por entrada, números que no son fechas (teléfonos, códigos), atribución por empleo y evidencia con posiciones | ✅ |
| `npm run test:unit`, otras pruebas: equivalencia y rendimiento de `normalizeForSearch` (antes cuadrática), sugerencias de términos (activación, tildes, duplicados, tope de 20 términos y 1000 caracteres), y el OCR que conserva el texto digital parcial | ✅ |
| Total de `npm run test:unit` (todas las pruebas anteriores) | ✅ **432/432** en 21 archivos (repetida por el coordinador) |
| `npm run test:db`: `apply_resume_ocr` con `sin_texto` no reemplaza un texto por nulo ni por uno más corto; con `completada` sí | ✅ **183/183** en 12 archivos |
| `npm run typecheck` / `lint` / `build` / `test:secrets` | ✅ sin errores · 0 valores secretos en 48 archivos |
| `tests/e2e/flujo-rrhh.spec.ts`: crear un requisito con «Agregar todos» y con una sugerencia suelta, y cargar un CV digital de 61 caracteres que se evalúa (fixture original) | ✅ escritorio. Falló dos veces por lentitud de la máquina (contenedores de Supabase reiniciándose) y pasó al repetir |
| `evaluar-pendientes`, `ocr-escaneado`, `carga-masiva` | ✅ antes del último ajuste de encabezados, que solo cambia `experience-dates.ts` |
| Revisión independiente | Sin bloqueantes. Se corrigieron las fechas de estudios tomadas como experiencia (encabezados no reconocidos), el último empleo que se extendía hasta el final de la sección, el coste cuadrático de la normalización, las fechas con día, los números parecidos a fechas y el tope de términos. Se acepta el caso del título de 3 líneas |

No probado:
- CV reales extraídos de PDF;
- la pantalla de sugerencias a ancho de celular y con el tope lleno;
- las evaluaciones anteriores con `reglas-v1`, que no se recalculan solas: hay que reevaluarlas.

## 5. No ejecutado (requiere recursos no disponibles)

| Prueba | Motivo | Cómo ejecutarla |
|---|---|---|
| Migraciones y flujo E2E sobre un proyecto Supabase **en la nube** | Sin proyecto de pruebas; solo se probó el stack local (sección 4 bis) | `npx supabase db push` en un proyecto de pruebas y repetir la sección 4 bis |
| Expiración de URL firmadas | No se automatizó | Descargar un CV y reintentar la URL tras 60 s |
| Adaptador de IA contra la API real | Proveedor no aprobado; sin clave | Ver [configuracion-ia.md](configuracion-ia.md) |
| Navegadores Firefox/WebKit | Solo se instaló Chromium | `npx playwright install` y añadir proyectos |
| Envío de correos de Auth (invitación y recuperación) | Requiere Supabase y SMTP | Ver [configuracion-correo.md](configuracion-correo.md) |

## 6. Cómo reproducir

```bash
npm install
npx playwright install chromium
npm run typecheck && npm run lint && npm test
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ficticia_para_pruebas_000 \
APP_URL=http://localhost:3100 npm run build
SUPABASE_SECRET_KEY=<valor centinela> npm run test:secrets
npm run test:e2e
```

## 7. Revisión independiente

Tras completar la etapa se encargó una revisión de seguridad y corrección a un agente independiente, que no conocía las conclusiones previas. Encontró 13 problemas confirmados con pruebas de concepto; todos se corrigieron y cada uno tiene una prueba de regresión:

| Severidad | Hallazgo | Corrección |
|---|---|---|
| Alta | *Zip bomb* con entradas superpuestas: los límites del DOCX se comprobaban tras descomprimir (800 MB retenidos con un archivo de 22 KB) | Presupuestos verificados antes de descomprimir cada entrada; entradas duplicadas rechazadas |
| Media | Falsos positivos de «contenido activo» en PDF con fotos | Se excluye el contenido binario de los *streams* del análisis |
| Media | Los usuarios podían firmar URL de CV directamente con su sesión, sin auditoría ni límite | Bucket sin políticas para usuarios; firma solo en el servidor tras RLS + límite + auditoría |
| Media | `consume_rate_limit` aceptaba máximo y ventana elegidos por quien llama | Límites fijados en SQL; solo se indica la operación |
| Media | Edad o antigüedad de una empresa tomadas como años de experiencia | Solo menciones explícitas de experiencia; la más cercana al término |
| Baja-media | Cualquier usuario podía escribir filas arbitrarias en la auditoría | Función genérica eliminada; `log_resume_download` verifica el acceso |
| Baja-media | Una segunda revisión borraba las observaciones de la primera | Revisión única por evaluación |
| Baja-media | Asignar un evaluador ajeno a la vacante no le daba acceso | La base de datos exige pertenencia al equipo; la lista solo muestra personas válidas |
| Baja-media | Un fallo tras registrar el CV dejaba una versión vigente sin texto | CV + extracción en una transacción (`register_resume`) |
| Baja | El nivel de compatibilidad no se verificaba en la base de datos | Se recalcula y se rechazan discrepancias |
| Baja | Identificadores de registros distintos no se cruzaban | FK compuesta y verificaciones en las acciones |
| Baja | Reglas de negocio solo en TypeScript (ciclo de la vacante, vacantes archivadas, borrado de postulaciones) | Aplicadas también en la base de datos |
| Baja | Las evaluaciones usaban siempre el CV más reciente | Se usa el CV de la postulación; cambiarlo es una acción explícita |

También se corrigió un defecto propio detectado durante la revisión: un usuario desactivado con sesión vigente entraba en un bucle de redirecciones.

Queda pendiente (no verificado): el límite de tiempo de la extracción de PDF no cancela el trabajo de PDF.js (ver [pendientes.md](pendientes.md)).
