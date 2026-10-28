# Arquitectura

## Estructura

```
src/
  app/                       Rutas (App Router)
    (app)/                   Área privada: panel, vacantes, candidatos, postulaciones, usuarios
    ingresar, recuperar, restablecer, auth/confirm   Autenticación
    api/resumes/[id]/download                        Descarga auditada de CV
  proxy.ts                   Sesión, redirección y Content Security Policy (antes "middleware")
  components/
    ui/                      shadcn/ui
    common/ app-shell/ auth/ vacancies/ candidates/ applications/ users/
  modules/                   Lógica por dominio
    <dominio>/schemas.ts     Validación Zod compartida cliente/servidor
    <dominio>/queries.ts     Lecturas (server-only, sujetas a RLS)
    <dominio>/actions.ts     Server Actions: autorizan, validan y escriben
    evaluation/              Motor de reglas, puntuación, adaptador de IA (lógica pura + servicio)
    resumes/                 Validación de archivos, inspección DOCX, extracción y sugerencias
  lib/                       Entorno, clientes Supabase, sesión y permisos, errores, auditoría, límites
  types/database.ts          Tipos generados desde las migraciones
supabase/
  migrations/                Esquema, RLS, funciones y Storage (SQL versionado)
  templates/                 Plantillas de correo de Auth
  config.toml                Configuración de Supabase CLI
tests/
  unit/                      Lógica pura y autorización de Server Actions
  db/                        Migraciones, RLS y reglas sobre PGlite + réplica mínima de Supabase
  e2e/                       Playwright
  fixtures/                  Generadores de documentos ficticios
scripts/                     Tipos, datos ficticios y verificación de secretos
```

## Decisiones

- **Seguridad en tres capas:** la interfaz oculta acciones no permitidas (comodidad), el servidor autoriza cada acción (`requirePermission`) y la base de datos aplica RLS y privilegios por columna (garantía final).
- **Escrituras críticas en la base de datos:** cambio de estado, registro de evaluaciones, revisión y aprobación de criterios son funciones SQL transaccionales que registran su historial; la aplicación no puede modificar esas columnas directamente.
- **Lógica de evaluación pura y determinista** (`src/modules/evaluation`), probada sin red; la base de datos recalcula los porcentajes como verificación cruzada.
- **Sin Cache Components / PPR:** desactivados para aplicar una CSP con nonce por solicitud y no cachear datos personales. Next.js anuncia que ambos serán obligatorios en la próxima versión mayor: revisar en esa migración.
- **Sin infraestructura adicional:** límites de solicitudes en PostgreSQL; sin colas, Redis ni servicios aparte.
- **Nombres de tablas:** la postulación (candidato × vacante) se modela como `applications` + `application_events` (equivalentes a `recruitment_processes` + `recruitment_events` del requerimiento), por claridad. Las tablas de entrevistas, feedback, notificaciones y privacidad se añadirán en sus etapas.
- **Tipos de base de datos** generados desde las migraciones con PGlite (`npm run db:types`), compatibles con el generador oficial de Supabase.
