# Controles de seguridad implementados

Estado a la Etapa 1, incluidas las correcciones de la revisión independiente de seguridad (ver [informe-pruebas.md](informe-pruebas.md#7-revisión-independiente)). «Probado» indica una prueba automatizada ejecutada (ver [informe-pruebas.md](informe-pruebas.md)); «PGlite» significa que se probó sobre PostgreSQL real en WASM con una réplica mínima de los esquemas de Supabase, no contra un proyecto Supabase.

## Autenticación y sesiones

| Control | Ubicación | Prueba |
|---|---|---|
| Sin registro público; altas solo por invitación de un administrador | `supabase/config.toml` (`enable_signup = false`), `src/modules/users/actions.ts` | E2E (no hay enlace de registro); configuración del panel pendiente de verificar |
| Rol inicial con menos privilegios; rol solo desde `app_metadata` | `…000100_foundation.sql` (`handle_new_user`) | PGlite |
| Sesión verificada en el servidor (`getClaims`) en cada página, acción y ruta | `src/lib/auth/session.ts` | Unitaria (autorización) |
| Cuenta desactivada con sesión vigente: se cierra la sesión sin bucles de redirección; la ruta no permite cierres forzados de cuentas activas | `src/app/auth/cuenta-desactivada/route.ts` | Unitaria + E2E |
| Redirección sin sesión en el proxy (comprobación optimista) | `src/proxy.ts` | E2E |
| Cuentas desactivadas: sin acceso por RLS y bloqueo en Auth | `profiles.is_active`, `private.current_app_role`, `src/modules/users/actions.ts` | PGlite + unitaria |
| Eliminación definitiva solo desde la papelera, solo por un administrador, nunca de la propia cuenta ni del último administrador activo. Queda auditado quién la pidió. El perfil se conserva sin correo y no se puede reactivar | `log_user_deletion`, `private.handle_deleted_user` (migración `20261023000200`), `src/modules/users/actions.ts` | PGlite + unitaria + E2E local |
| Siempre un administrador activo | trigger `guard_profile_update` | PGlite |
| Recuperación de contraseña sin enumeración de usuarios | `src/modules/auth/actions.ts` | E2E |
| Enlaces de correo con `token_hash`, solo tipos `invite`/`recovery`, sin redirecciones abiertas | `src/app/auth/confirm/route.ts`, `src/lib/safe-redirect.ts` | Unitaria + E2E |
| Política de contraseñas (≥12, letras y números) | `src/modules/auth/schemas.ts`, `config.toml` | — |

## Autorización

| Control | Ubicación | Prueba |
|---|---|---|
| Matriz de permisos por rol, verificada en el servidor | `src/lib/auth/permissions.ts`, `requirePermission` | Unitaria |
| Cada Server Action autoriza antes de tocar datos | `src/modules/*/actions.ts` | Unitaria (15 acciones con cuenta desactivada, más RRHH y sesión) |
| Identificadores cruzados verificados (extracción ↔ candidato, evaluación ↔ postulación, CV de origen ↔ candidato) | `resumes/actions.ts`, `applications/actions.ts`, FK compuesta `candidate_profile_items_resume_fk` | Unitaria + PGlite |
| Reglas de negocio también en la base de datos: ciclo de vida de la vacante, vacantes archivadas inmutables, opinión solo de personas con cuenta activa, postulaciones sin borrado, una postulación en proceso por candidato | `guard_vacancy_status`, `change_application_status`, `approve_vacancy_criteria`, `check_assigned_evaluator`, `check_one_application_in_process`, GRANTs | PGlite |
| Pedir opinión solo mediante `request_opinion` (RRHH o administración; nunca la propia). La columna `assigned_evaluator_id` no se puede escribir directamente | migraciones `20261023000300` y `…000500`, `src/modules/applications/actions.ts` | PGlite + unitaria + E2E local |
| Notificaciones: solo la persona consultada lee la suya. No la ven quien la pidió, ni administración, ni otras personas, ni una cuenta desactivada. Cada persona solo marca como leídas las suyas. Nadie las crea directamente: las generan funciones de la base de datos. La ruta `/api/notificaciones` exige sesión activa y no se guarda en caché | RLS `notifications_*`, `src/app/api/notificaciones/route.ts` | PGlite |
| RLS en todas las tablas; privilegios explícitos; `anon` sin acceso | `supabase/migrations/*` | PGlite |
| Solo administración y RRHH, con cuenta activa, acceden a los datos. Las cuentas creadas sin rol válido nacen desactivadas (el rol evaluador se eliminó el 23/10/2026) | `private.can_access_*`, `handle_new_user` (migración `20261023000500`) | PGlite |
| Escrituras sensibles solo por funciones `SECURITY DEFINER` con `search_path` vacío (estado del proceso, evaluaciones, revisión única, aprobación de criterios, registro de CV + extracción) | `…000300`, `…000400` | PGlite |
| Evaluaciones: la base de datos recalcula porcentajes **y nivel** y rechaza discrepancias; cada evaluación se revisa una sola vez | `record_evaluation`, `review_evaluation` | PGlite (incl. 60 combinaciones TS↔SQL) |
| Columnas protegidas por privilegios a nivel de columna (estado, criterios, autoría) | GRANTs en migraciones | PGlite |
| Autoría no suplantable (`created_by`, `actor_id`, `uploaded_by` desde `auth.uid()`) | `private.set_actor_column` | PGlite |

## Archivos (CV)

| Control | Ubicación | Prueba |
|---|---|---|
| Bucket privado, 4 MB, solo PDF/DOCX, **sin políticas para usuarios**: todo acceso pasa por el servidor | `…000500_storage.sql` | PGlite |
| Rutas `candidates/{id}/{resume_id}.ext` generadas por el servidor y validadas en BD | `resumes_storage_path_check` | PGlite |
| CV y extracción registrados en una transacción; sin sobrescritura (versionado); el archivo se elimina si el registro falla | `register_resume`, `prepare_resume_version`, `src/modules/resumes/actions.ts` | PGlite |
| Las evaluaciones usan el CV asociado a la postulación; cambiarlo es una acción explícita | `evaluation/service.ts`, `linkCurrentResume` | — |
| Validación de extensión, tipo declarado, tamaño, firma y estructura | `src/modules/resumes/file-validation.ts` | Unitaria |
| PDF: rechazo de JavaScript, acciones de lanzamiento, adjuntos, XFA (incl. nombres ofuscados) | ídem | Unitaria |
| PDF: el análisis excluye el contenido binario de los *streams* (evita falsos positivos con fotos) | ídem | Unitaria (100 PDF con imagen aleatoria) |
| DOCX: rechazo de macros, objetos incrustados, plantillas externas; presupuestos de entradas y tamaño verificados **antes** de descomprimir cada entrada (zip bomb, entradas duplicadas o superpuestas) | `src/modules/resumes/docx.ts` | Unitaria (zip bomb de 40 entradas superpuestas) |
| Extracción con límite de tiempo, sin ejecutar el documento; DOCX reempaquetado solo con partes de texto | `src/modules/resumes/extraction.ts` | Unitaria |
| Descarga: sesión + RLS + límite + auditoría obligatoria y, solo después, URL firmada de 60 s con `Content-Disposition: attachment` | `src/app/api/resumes/[id]/download/route.ts` | Unitaria (orden verificado) + E2E (401) |

## Aplicación web

| Control | Ubicación | Prueba |
|---|---|---|
| Content Security Policy con nonce por solicitud y `strict-dynamic` | `src/proxy.ts` | E2E (sin violaciones) |
| `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS (prod.), sin `X-Powered-By` | `next.config.ts` | E2E |
| Páginas privadas `Cache-Control: private, no-store, no-transform`: sin caché de datos de candidatos y sin modificaciones de intermediarios (CDN, túneles, proxies) | `src/proxy.ts`, `next.config.ts` | — |
| Validación de entradas con Zod en el servidor (además del cliente) | `src/modules/*/schemas.ts`, `parseInput` | Unitaria |
| Errores sin detalles internos; logs sin datos personales | `src/lib/errors.ts`, `src/app/(app)/error.tsx` | Unitaria |
| Protección CSRF de Server Actions (comparación de origen de Next.js) | Next.js | — |
| Búsquedas saneadas para filtros de PostgREST | `src/lib/search.ts` | — |

## Secretos

| Control | Ubicación | Prueba |
|---|---|---|
| Variables secretas solo en el servidor; `server-only` en módulos sensibles | `src/lib/env.ts`, `src/lib/supabase/admin.ts` | `npm run test:secrets` (con control negativo) |
| Clave secreta de Supabase usada solo en el servidor para Storage (tras autorizar/auditar) y para invitar/bloquear usuarios | `src/lib/supabase/admin.ts` | Unitaria (no se crea para roles no autorizados ni si el CV no es visible) |
| `.env*` excluido de git; `.env.example` sin valores | `.gitignore` | — |

## Límites de uso

| Control | Ubicación | Prueba |
|---|---|---|
| Límite por usuario y ventana, persistido en BD (válido en serverless); máximos y ventanas fijados en SQL, no elegibles por quien llama | `consume_rate_limit`, `src/lib/rate-limit.ts` | PGlite |
| Carga de CV 20/10 min, descargas 60/10 min, evaluaciones 30/10 min, IA 10/10 min + límite diario global, invitaciones 10/h | `consume_rate_limit` | PGlite (cv_upload) |
| Límites de inicio de sesión y correos | Supabase Auth (`[auth.rate_limit]`) | — |

## Auditoría

| Control | Ubicación | Prueba |
|---|---|---|
| Registro automático de altas, cambios y bajas (campos modificados, sin valores personales) | `private.audit_row_change` | PGlite |
| Descargas de CV registradas con una función específica que verifica el acceso (no existe una función genérica para escribir en la auditoría) | `log_resume_download`, ruta de descarga | PGlite + unitaria |
| Auditoría inmutable y visible solo para administración | trigger `audit_logs_immutable`, RLS | PGlite |
| Historial del proceso: estado anterior/nuevo, responsable, fecha, motivo | `change_application_status`, `application_events` | PGlite |

## Pendientes de seguridad

Ver [pendientes.md](pendientes.md): extracción de PDF en un *worker* aislado con límites de memoria/tiempo, antivirus/escaneo de archivos en un servicio aislado, MFA para administradores, pruebas contra un Supabase real, procedimiento de respaldo y restauración probado, política de incidentes formal, revisión de retención de logs de proveedores, carga directa a Storage para archivos > 4 MB, OCR en entorno aislado.
