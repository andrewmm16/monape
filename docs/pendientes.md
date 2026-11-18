# Errores conocidos y tareas pendientes

Los planes detallados por etapa (carpetas `etapa-1/`, `etapa-2/` y `etapa-3/`) se retiraron del proyecto el 27/10/2026. Este documento conserva las limitaciones conocidas, el resumen de cada etapa y la lista de tareas de la Etapa 4. Para una explicación general de la plataforma, ver [como-funciona.md](como-funciona.md).

## Limitaciones conocidas de la Etapa 1

| # | Limitación | Impacto | Próximo paso |
|---|---|---|---|
| 1 | **Probado contra Supabase local (Docker), aún no contra un proyecto en la nube.** Migraciones, datos ficticios y flujo E2E de RRHH pasan en el stack local (ver [informe-pruebas.md](informe-pruebas.md#4-bis-ejecución-contra-supabase-local-docker--22102026)). | La configuración de Auth del proyecto en la nube se hace en el panel, no con `config.toml`. | Cierre de la Etapa 1: proyecto en la nube y despliegue. |
| 2 | ~~Adaptador de IA no probado contra la API real.~~ **Resuelto el 18/11/2026** para la vía en uso (`claude-cli`: cola + worker con la suscripción): probado de punta a punta con Haiku en la app y medido contra la vara (ver [configuracion-ia.md](configuracion-ia.md)). El adaptador `anthropic` (API de pago) sigue probado solo con respuestas simuladas. | Solo si se cambia a la API de pago. | Probarlo si algún día se usa `AI_PROVIDER=anthropic`. |
| 3 | ~~OCR no disponible: PDF escaneados quedan «sin texto».~~ **OCR local disponible desde el 28/10/2026** (tesseract.js, sin enviar datos fuera). Limitaciones:<br>- lee mal la arroba, así que el correo casi nunca se propone;<br>- lee como máximo 4 páginas;<br>- **probado el 18/11/2026 con CV reales de Wikimedia Commons** (licencias libres): un CV de muestra en español escaneado a 150 ppp recuperó el 100 % de sus palabras, y como foto de celular torcida y con sombra el 99 %, con el nombre bien sugerido. Un CV de ejemplo en inglés de baja resolución (72 ppp), uno en francés y uno escrito a máquina en 1937 se leyeron bien y se detectaron sus teléfonos;<br>- ~~la arroba se leía como «2a» y el correo no se sugería~~ **resuelto el 18/11**: se reconstruye (`…2agmail.com` → `…@gmail.com`) solo ante proveedores conocidos, con la cita original a la vista;<br>- ~~el aviso de relleno daba falsos positivos con CV en otros idiomas o con la profesión repetida~~ **resuelto el 18/11**: ignora palabras vacías de otros idiomas y el uso natural en frases. | RRHH revisa el texto y los datos sugeridos. | Motor de IA como principal cuando se apruebe (el local queda de respaldo). |
| 4 | ~~El análisis de contenido activo de PDF no ve dentro de *object streams* comprimidos.~~ **Resuelto el 18/11/2026**: se descomprimen y se revisan (ver [seguridad.md](seguridad.md)). No hay antivirus: **Omar decidió el 18/11 que no hace falta** (solo PDF/DOCX, sin scripts, macros, adjuntos ni plantillas externas; los archivos nunca se ejecutan en el servidor y se descargan como adjunto). | Riesgo residual bajo al abrir CV descargados: abrirlos en el visor del navegador o en Word (vista protegida). | Revisar si cambia el volumen o el origen de los CV. |
| 5 | CV limitados a 4 MB (límite de cuerpo de Vercel). | CV grandes deben comprimirse. | Carga directa a Storage con URL firmadas y validación posterior, si hace falta. |
| 6 | ~~El trigger `handle_new_user` lee el rol de `app_metadata`, pero Supabase Auth lo guarda después de insertar el usuario.~~ **Resuelto el 23/10/2026** (migración `20261023000500`): toda cuenta sin rol válido nace desactivada, y la invitación y el script de datos ficticios la activan con su rol. | — | — |
| 7 | ~~Al eliminar un candidato (solo por SQL/administración) no se borran sus archivos del bucket.~~ **Resuelto el 18/11/2026**: la tarea diaria `/api/tareas/limpieza-cv` borra los CV que nada referencia (ver riesgo 15). | — | — |
| 8 | La detección de años de experiencia es heurística (menciones explícitas de «años de experiencia»), no calcula por fechas. | Más requisitos «pendientes de verificación». | Etapa 2, paquete 2.5, parte B (motor de reglas v2). |
| 9 | El estado de notificación en el listado de candidatos muestra «No disponible». | Informativo. | Etapa 3, paquete 3.2. |
| 10 | ~~Sin modo oscuro ni selector de tema.~~ **Ya existe**: selector de tema en la barra superior. | — | — |
| 11 | Next.js 16 anuncia Cache Components obligatorio en la próxima versión mayor; la app lo desactiva para usar CSP con nonce. | Migración futura. | Revisar al actualizar Next.js. |
| 12 | ~~El límite de tiempo de la extracción de PDF no cancelaba el trabajo de PDF.js; un PDF patológico podía ocupar la función hasta su tiempo máximo.~~ **Resuelto en local el 27/10/2026.** La extracción corre en un `worker_threads` con límites de memoria y de pila, y un plazo de 20 s. Al vencer el plazo, el worker se termina. | Falta probarlo en Vercel (el rastreo de archivos incluye el worker). | Verificar en el primer despliegue. |
| 13 | ~~Un evaluador veía todos los CV de los candidatos de sus vacantes.~~ **Ya no aplica**: el rol evaluador se eliminó el 23/10/2026. | — | — |
| 14 | El resumen y las limitaciones de cada evaluación los redacta el servidor; la base de datos verifica porcentajes, nivel y requisitos, pero no esos textos. | Integridad (solo RRHH/administración pueden registrar). | Aceptado. |
| 15 | ~~**Archivos huérfanos en Storage.**~~ **Resuelto el 18/11/2026**: `list_orphan_resume_files` compara el bucket con `resumes` e `intake_batch_items` y la tarea diaria borra lo que nadie referencia, con un margen de 48 h. | Falta comprobarlo en la nube con Vercel Cron. | Comprobación del despliegue. |
| 16 | **Protección del formulario público.** La prueba de trabajo (16 bits) solo frena robots sencillos; la protección real es el límite por conexión (20 por hora), por vacante (300 por hora) y total (1000 por día). | Un ataque dirigido podría agotar el cupo de una vacante o el diario. | Si hay abuso: una verificación de un tercero (decisión técnica y legal) o subir la dificultad. |
| 17 | **Procedencia del texto OCR.** La función `apply_resume_ocr` la puede llamar cualquier usuario de RRHH o administración con acceso al candidato. Quien la llame directamente podría guardar un texto propio marcado como OCR en un CV sin texto, y la fila no guarda quién lo hizo. Solo funciona si el CV no tiene una transcripción de RRHH. | Integridad. Solo afecta a personal con acceso; no da acceso nuevo. | Aceptado (revisión del 28/10/2026). Si se quiere blindar: dejar la función solo para la clave de servicio. |
| 18 | **Escaneados que esperan su lectura.** Si llegan muchos CV escaneados a la vez por el formulario o por Talent.com, los que esperan más de 60 s en la cola del OCR quedan sin leer. No se pierden: «Evaluar pendientes» o el botón «Leer escaneo automáticamente» los leen después. | Algunas postulaciones quedan sin evaluar hasta que RRHH actúa. | Aceptado; revisar si el volumen lo exige. |

## Etapa 2 · Captación de postulantes y evaluación

Incluye las tareas originales de esta etapa (IA, extracción estructurada y OCR, corrección por requisito, comparación, feedback y documentos defectuosos) y añade la postulación en línea con un enlace por portal, la carga masiva de CV, el aviso de privacidad con registro de consentimiento, las páginas públicas de vacantes con su feed y la recepción de postulaciones de Talent.com.

Terminados y probados en local al 27/10/2026: catálogo de portales, carga masiva de CV y bandeja de entrada (2.3), páginas públicas, datos para Google y feed (2.9), y recepción de Talent Apply (2.10, probada solo con envíos simulados). El 28/10/2026 se añadieron:
- el botón «Evaluar pendientes» por vacante;
- la lectura local de CV escaneados (OCR);
- los años de experiencia por fechas;
- la sugerencia de términos;
- la verificación de requisitos tras la entrevista, que hace las veces de la «corrección por requisito»;
- la comparación de candidatos con el orden de «mejor opción».

Todo lo anterior ya está versionado; ver [informe-pruebas.md](informe-pruebas.md).

## Etapa 3 · Comunicaciones, entrevistas e informes

Comprende la infraestructura de correo con Resend, plantillas y bandeja con aprobación, entrevistas, indicadores del panel, exportación CSV, informes y consulta de auditoría.

**Adelantado el 28/10/2026:** módulo de entrevistas, sin correos ni invitaciones.
- Programar, reprogramar y cancelar.
- Página «Entrevistas».
- Resultado Pasó / No pasó / No asistió, con requisitos comprobados.
- Vista «Descartados» en cada vacante.
- Tarjeta en el panel.

**Estado al 18/11/2026: implementada y probada en local.**
- **Correo con Resend:** acuses, cambios de estado con plantillas editables, entrevistas, invitaciones de la base de talentos y mensajes. Ver [configuracion-correo.md](configuracion-correo.md).
- **Entrevistas:** avisos de agenda, cambio y cancelación a la persona candidata y a los entrevistadores con correo, más el recordatorio automático (tarea programada) y la evaluación colaborativa.
- **Panel y reportes:** embudo, fuentes, tiempos y exportación a CSV.
- **Consulta de auditoría** con frases legibles.

Falta un dominio verificado en Resend para enviar de verdad, que se configura en el despliegue.

~~En celulares de 390 px, la campana y el menú se salían de la pantalla.~~ Resuelto el 18/11/2026: en celulares el menú de usuario muestra solo el ícono (`tests/e2e/diseno-movil.spec.ts`, a 360 y 390 px).

## Etapa 4 · Producción

- [x] Barrido periódico de archivos huérfanos en Storage y borrado de los archivos al eliminar un candidato (riesgos 7 y 15). Tarea diaria `/api/tareas/limpieza-cv`.
- [ ] MFA para administradores: **descartada por ahora** (18/11/2026). Se implementa solo si se pide.
- [x] Respaldo y restauración probados **en local** ([respaldo-y-restauracion.md](respaldo-y-restauracion.md)). *Falta ensayarlo en la nube.*
- [x] Política de incidentes: [politica-incidentes.md](politica-incidentes.md) (18/11/2026; incluye la notificación en 48 h que exige el reglamento de la Ley 29733). Falta el simulacro antes de producción.
- [x] Revisión automática de RLS y privilegios sobre todas las migraciones (`tests/db/security-catalog.test.ts`).
- [ ] Pruebas de seguridad contra Supabase real; pentest externo recomendado.
- [x] Plazo de conservación: la administración revisa a los candidatos sin actividad y los anonimiza a mano («Candidatos → Plazo de conservación»).
- [x] Recordatorios automáticos de entrevista (tarea programada diaria).
- [x] Portal del candidato: **encendido en local el 18/11/2026** con el OK de Omar (muestra solo puesto, etapa, fechas y próxima entrevista; probado con un enlace abierto sin sesión). Es un ajuste de la base: en producción hay que volver a encenderlo en «Configuración → Portal del candidato». Encendido, el enlace (estable) va solo en los correos a la persona candidata.
