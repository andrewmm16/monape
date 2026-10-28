# Errores conocidos y tareas pendientes

Los planes detallados por etapa (carpetas `etapa-1/`, `etapa-2/` y `etapa-3/`) se retiraron del proyecto el 27/10/2026. Este documento conserva las limitaciones conocidas, el resumen de cada etapa y la lista de tareas de la Etapa 4. Para una explicación general de la plataforma, ver [como-funciona.md](como-funciona.md).

## Limitaciones conocidas de la Etapa 1

| # | Limitación | Impacto | Próximo paso |
|---|---|---|---|
| 1 | **Probado contra Supabase local (Docker), aún no contra un proyecto en la nube.** Migraciones, datos ficticios y flujo E2E de RRHH pasan en el stack local (ver [informe-pruebas.md](informe-pruebas.md#4-bis-ejecución-contra-supabase-local-docker--22102026)). | La configuración de Auth del proyecto en la nube se hace en el panel, no con `config.toml`. | Cierre de la Etapa 1: proyecto en la nube y despliegue. |
| 2 | Adaptador de IA no probado contra la API real (solo respuestas simuladas). | Puede requerir ajustes de parámetros del modelo. | Etapa 2, paquete 2.4, tras aprobar el proveedor. |
| 3 | ~~OCR no disponible: PDF escaneados quedan «sin texto».~~ **OCR local disponible desde el 28/10/2026** (tesseract.js, sin enviar datos fuera). Limitaciones:<br>- lee mal la arroba, así que el correo casi nunca se propone;<br>- lee como máximo 4 páginas;<br>- solo se probó con escaneos generados de texto limpio, no con fotos ni escaneos reales. | RRHH debe revisar el texto y escribir el correo. | Probar con escaneos ficticios reales. Motor de IA como principal cuando se apruebe (el local queda de respaldo). |
| 4 | El análisis de contenido activo de PDF no ve dentro de *object streams* comprimidos. No hay antivirus. | Riesgo residual al abrir CV descargados. Aumenta con el formulario público de la Etapa 2. | Escaneo antivirus en un servicio aislado; abrir CV en visores actualizados. Pendiente de decisión de la empresa. |
| 5 | CV limitados a 4 MB (límite de cuerpo de Vercel). | CV grandes deben comprimirse. | Carga directa a Storage con URL firmadas y validación posterior, si hace falta. |
| 6 | ~~El trigger `handle_new_user` lee el rol de `app_metadata`, pero Supabase Auth lo guarda después de insertar el usuario.~~ **Resuelto el 23/10/2026** (migración `20261023000500`): toda cuenta sin rol válido nace desactivada, y la invitación y el script de datos ficticios la activan con su rol. | — | — |
| 7 | Al eliminar un candidato (solo por SQL/administración) no se borran sus archivos del bucket. | Archivos huérfanos. | Procedimiento de cancelación (Etapa 4). |
| 8 | La detección de años de experiencia es heurística (menciones explícitas de «años de experiencia»), no calcula por fechas. | Más requisitos «pendientes de verificación». | Etapa 2, paquete 2.5, parte B (motor de reglas v2). |
| 9 | El estado de notificación en el listado de candidatos muestra «No disponible». | Informativo. | Etapa 3, paquete 3.2. |
| 10 | Sin modo oscuro ni selector de tema. | Estético. | Opcional. |
| 11 | Next.js 16 anuncia Cache Components obligatorio en la próxima versión mayor; la app lo desactiva para usar CSP con nonce. | Migración futura. | Revisar al actualizar Next.js. |
| 12 | ~~El límite de tiempo de la extracción de PDF no cancelaba el trabajo de PDF.js; un PDF patológico podía ocupar la función hasta su tiempo máximo.~~ **Resuelto en local el 27/10/2026.** La extracción corre en un `worker_threads` con límites de memoria y de pila, y un plazo de 20 s. Al vencer el plazo, el worker se termina. | Falta probarlo en Vercel (el rastreo de archivos incluye el worker). | Verificar en el primer despliegue. |
| 13 | ~~Un evaluador veía todos los CV de los candidatos de sus vacantes.~~ **Ya no aplica**: el rol evaluador se eliminó el 23/10/2026. | — | — |
| 14 | El resumen y las limitaciones de cada evaluación los redacta el servidor; la base de datos verifica porcentajes, nivel y requisitos, pero no esos textos. | Integridad (solo RRHH/administración pueden registrar). | Aceptado. |
| 15 | **Archivos huérfanos en Storage.** Si el servidor se cae entre guardar un CV y registrarlo (formulario público, Talent.com o carga masiva), el archivo queda sin borrar. | Espacio y datos personales sin uso. | Barrido periódico que compare Storage con `resumes.storage_path` (Etapa 4, conservación y depuración). |
| 16 | **Protección del formulario público.** La prueba de trabajo (16 bits) solo frena robots sencillos; la protección real es el límite por conexión (20 por hora), por vacante (300 por hora) y total (1000 por día). | Un ataque dirigido podría agotar el cupo de una vacante o el diario. | Si hay abuso: captcha de un tercero (decisión técnica y legal) o subir la dificultad. |
| 17 | **Procedencia del texto OCR.** La función `apply_resume_ocr` la puede llamar cualquier usuario de RRHH o administración con acceso al candidato. Quien la llame directamente podría guardar un texto propio marcado como OCR en un CV sin texto, y la fila no guarda quién lo hizo. Solo funciona si el CV no tiene una transcripción de RRHH. | Integridad. Solo afecta a personal con acceso; no da acceso nuevo. | Aceptado (revisión del 28/10/2026). Si se quiere blindar: dejar la función solo para la clave de servicio. |
| 18 | **Escaneados que esperan su lectura.** Si llegan muchos CV escaneados a la vez por el formulario o por Talent.com, los que esperan más de 60 s en la cola del OCR quedan sin leer. No se pierden: «Evaluar pendientes» o el botón «Leer escaneo automáticamente» los leen después. | Algunas postulaciones quedan sin evaluar hasta que RRHH actúa. | Aceptado; revisar si el volumen lo exige. |

## Etapa 2 · Captación de postulantes y evaluación

Incluye las tareas originales de esta etapa (IA, extracción estructurada y OCR, corrección por requisito, comparación, feedback y documentos defectuosos) y añade la postulación en línea con un enlace por portal, la carga masiva de CV, el aviso de privacidad con registro de consentimiento, las páginas públicas de vacantes con su feed y la recepción de postulaciones de Talent.com.

Terminados y probados en local al 27/10/2026: catálogo de portales, carga masiva de CV y bandeja de entrada (2.3), páginas públicas, datos para Google y feed (2.9), y recepción de Talent Apply (2.10, probada solo con envíos simulados). El 28/10/2026 se añadieron el botón «Evaluar pendientes» por vacante y la lectura local de CV escaneados (OCR). Ver [informe-pruebas.md](informe-pruebas.md). Las opciones para LinkedIn, Bumeran, Trabajos Diarios y Computrabajo están evaluadas en [opcion-correos-de-aviso.md](opcion-correos-de-aviso.md) y [opcion-robot.md](opcion-robot.md).

## Etapa 3 · Comunicaciones, entrevistas e informes

Comprende la infraestructura de correo con Resend, plantillas y bandeja con aprobación, entrevistas, indicadores del panel, exportación CSV, informes y consulta de auditoría.

## Etapa 4 · Privacidad y producción

- [ ] Tabla `privacy_requests`; gestión de solicitudes ARCO; exportación y cancelación (incluidos archivos). Las tablas `privacy_notices` y `consent_records` se adelantaron a la Etapa 2 (paquete 2.1).
- [ ] Plazos de conservación y depuración programada (incluidos los lotes de carga masiva no registrados y el cuerpo de los correos enviados).
- [ ] MFA para administradores; revisión de sesiones.
- [ ] Respaldo y restauración probados; política de incidentes.
- [ ] Revisión de RLS y pruebas de seguridad contra Supabase real; pentest externo recomendado.
- [ ] Informe de riesgos y pendientes legales (ver [privacidad-y-legal.md](privacidad-y-legal.md)).
