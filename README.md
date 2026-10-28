# Plataforma de reclutamiento y selección · Interruptivo Perú

Aplicación web privada para el área de Recursos Humanos: vacantes con criterios ponderados, registro de candidatos y CV, extracción de texto, evaluación de compatibilidad **explicable y orientativa**, seguimiento del proceso y auditoría.

> **Principio rector:** la plataforma asiste a RRHH; nunca selecciona ni rechaza a nadie por sí sola. Todos los candidatos son visibles y cada evaluación muestra criterios, evidencias y limitaciones. La plataforma puede **sugerir** un estado a partir de la compatibilidad, pero el estado del proceso solo cambia cuando una persona lo revisa y lo guarda.

**Estado: Etapa 1 implementada** (ver [qué incluye](#qué-incluye-la-etapa-1) y [docs/pendientes.md](docs/pendientes.md)). De la Etapa 2 están terminadas la carga masiva de CV con bandeja de entrada y las páginas públicas de vacantes con su feed. El flujo principal se probó de punta a punta contra **Supabase local (Docker)**; aún no contra un proyecto en la nube (ver [docs/informe-pruebas.md](docs/informe-pruebas.md)). Lo que falta está en [docs/pendientes.md](docs/pendientes.md). Para una explicación sin tecnicismos, con un caso de uso completo, ver [docs/como-funciona.md](docs/como-funciona.md).

### Ejecutar en local con Docker

```bash
npx supabase start     # Postgres 17, Auth, Storage y Studio; aplica las migraciones
# Copie a .env.local la URL y las claves PUBLISHABLE_KEY / SECRET_KEY que imprime
npm run db:seed        # usuarios admin@ / rrhh@reclutamiento.test
npm run dev            # http://localhost:3000 · Studio: http://127.0.0.1:54323
```

Para repetir desde cero: `npx supabase db reset && npm run db:seed`. Los correos de Auth (recuperación, invitaciones) no salen de la máquina: se ven en Mailpit, en http://127.0.0.1:54324.

### Mostrar la demo por un túnel (temporal)

Solo se expone la aplicación, compilada en modo producción y escuchando en `127.0.0.1`. **Nunca** se expone Supabase (puertos 54321–54324): en local usa claves de demostración públicas.

```bash
npm run build
npx next start -p 3001 -H 127.0.0.1
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3001   # imprime una URL https://….trycloudflare.com
```

Limitaciones: la URL cambia cada vez que se abre el túnel y solo funciona mientras el equipo y ambos procesos estén activos. Desde fuera, «Descargar CV» no funciona: redirige a una URL firmada de Supabase en `127.0.0.1`. Los enlaces de invitación y recuperación apuntan a `localhost`. Los cambios de código no se ven hasta volver a compilar y reiniciar. Cloudflare descifra el tráfico en sus servidores: use solo datos ficticios.

## Stack

| Capa | Tecnología |
|---|---|
| Aplicación | Next.js 16.4 (App Router, Server Actions, Route Handlers), React 19, TypeScript estricto |
| Interfaz | Tailwind CSS 4, shadcn/ui (Radix), React Hook Form + Zod |
| Datos y acceso | Supabase: PostgreSQL con RLS, Auth, Storage (bucket privado) |
| CV | `unpdf` (PDF.js) para PDF, `mammoth` + `fflate` para DOCX |
| IA (opcional, deshabilitada) | SDK de Anthropic, salida estructurada validada con Zod |
| Pruebas | Vitest (unitarias, autorización, RLS sobre PostgreSQL/PGlite), Playwright |
| Despliegue | Vercel + Supabase |

## Requisitos

- Node.js ≥ 22.12 (probado con 24.22.1 LTS).
- Un proyecto Supabase (nube) o Supabase CLI con Docker para desarrollo local.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local          # complete los valores (ver tabla abajo)
# Aplicar migraciones en su proyecto Supabase: docs/configuracion-supabase.md
npm run dev                          # http://localhost:3000
```

Datos ficticios para desarrollo (usuarios admin y RRHH, 3 vacantes, 5 candidatos con CV generados):

```bash
npm run db:seed    # solo contra Supabase local, o con SEED_ALLOW_REMOTE=true en un proyecto de PRUEBAS
```

### Variables de entorno

Detalle completo en [`.env.example`](.env.example).

| Variable | Ámbito | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | pública | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | pública | Clave publicable (o `anon` heredada). Protegida por RLS |
| `SUPABASE_SECRET_KEY` | **solo servidor** | Clave secreta (o `service_role`). Para subir y firmar descargas de CV tras autorizar y auditar, invitar/bloquear usuarios, el script de datos ficticios y firmar la cookie del cierre por inactividad (sin ella no se puede iniciar sesión) |
| `APP_URL`, `APP_ENV` | servidor | URL pública (enlaces de correo) y entorno |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_EXTERNAL_PROCESSING_APPROVED`, `AI_MAX_EVALUATIONS_PER_DAY`, `AI_MAX_INPUT_CHARS` | servidor | IA opcional. Desactivada por defecto y bloqueada hasta aprobación expresa |
| `PUBLIC_JOBS_ENABLED`, `PUBLIC_SITE_URL`, `PUBLIC_COMPANY_NAME`, `PUBLIC_COMPANY_WEBSITE`, `PUBLIC_COMPANY_LOGO_URL` | servidor | Páginas públicas de vacantes, JSON-LD y feed (2.9). Apagadas por defecto; encendidas exigen URL del sitio y nombre de la empresa |
| `TALENT_APPLY_ENABLED`, `TALENT_APPLY_SECRET`, `TALENT_FEED_TOKEN` | servidor | Recepción de Talent Apply y su feed (2.10). Apagada por defecto (las rutas `/api/integraciones/talent/*` responden 404); encendida exige `PUBLIC_SITE_URL`, `PUBLIC_COMPANY_NAME` y dos secretos de al menos 32 caracteres |
| `PUBLIC_APPLY_ENABLED`, `INTAKE_HASH_SECRET` | servidor | Formulario público de postulación (2.2) en `/empleos/<vacante>`. Apagado por defecto (se mantiene el botón deshabilitado); encendido exige `PUBLIC_JOBS_ENABLED=true`, `SUPABASE_SECRET_KEY` y un secreto de al menos 32 caracteres que firma los desafíos anti-abuso y deriva (HMAC) el identificador de límite por IP. Solo se ofrece con un aviso de privacidad vigente |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DELIVERY_MODE` | servidor | Etapa 3 (aún no usadas) |

La aplicación nunca expone variables sin prefijo `NEXT_PUBLIC_` al navegador; `npm run test:secrets` lo verifica sobre el build.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Desarrollo, compilación y servidor de producción |
| `npm run typecheck` / `lint` | TypeScript estricto y ESLint |
| `npm test` | Todas las pruebas de Vitest |
| `npm run test:unit` | Lógica pura y autorización de Server Actions |
| `npm run test:db` | Migraciones, RLS y reglas de negocio sobre PostgreSQL real (PGlite, sin Docker) |
| `npm run test:e2e` | Playwright (requiere `npm run build` previo) |
| `npm run test:secrets` | Busca secretos en el código del navegador (tras `build`) |
| `npm run db:types` | Regenera `src/types/database.ts` desde las migraciones |
| `npm run db:seed` | Carga datos ficticios |

## Qué incluye la Etapa 1

- **Acceso:** inicio/cierre de sesión, recuperación de contraseña por enlace temporal, sin registro público, invitación de usuarios por un administrador, roles `admin` / `rrhh` (el rol `evaluador` se eliminó el 23/10/2026; ambos roles ven todas las vacantes). Una cuenta creada fuera de la plataforma sin rol válido nace desactivada. Una cuenta desactivada pasa a la **papelera** (`/usuarios/papelera`). Desde ahí se reactiva o se elimina definitivamente: se borran la cuenta y el correo, y el nombre se conserva en el historial con la marca «(eliminado)».
- **Panel:** vacantes publicadas, postulaciones en proceso, evaluaciones y revisiones pendientes, candidatos por etapa y por vacante, actividad reciente. Todo calculado en la base de datos con el ámbito del usuario.
- **Vacantes:** creación, edición, publicación interna, cierre, archivo; requisitos ponderados (formación, experiencia, habilidades, herramientas, certificaciones, competencias, idiomas) con prioridad obligatorio/deseable, años mínimos y marca de requisito legal/esencial; **aprobación de criterios versionada**.
- **Candidatos:** registro manual, detección de posibles duplicados (ventana emergente antes de registrar), origen de cada dato (declarado / extraído / verificado), perfil profesional, fuente. **Una sola postulación en proceso por candidato**: puede postular a otra vacante cuando la anterior termina (seleccionado, no seleccionado, en reserva o retirado) o se archiva su vacante. La base de datos lo valida.
- **CV:** carga PDF/DOCX con validación de extensión, tipo, tamaño, firma y estructura interna; bucket privado sin acceso directo de usuarios; versionado con registro atómico del CV y su extracción; descarga por URL firmada de 60 s, solo tras verificar acceso y registrar la auditoría; extracción de texto y sugerencias (correo, teléfono, LinkedIn, herramientas) que RRHH aplica o descarta; corrección manual del texto.
- **Evaluación de compatibilidad:** motor de reglas determinista con evidencias literales del CV, cuatro valoraciones (acreditado / aparentemente no cumplido / sin evidencia / pendiente de verificación), puntuación ponderada reproducible con rango (acreditado–máximo alcanzable), nivel orientativo, limitaciones explícitas, historial y revisión humana. Adaptador de IA implementado pero **bloqueado** hasta aprobación del proveedor.
- **Listado completo por vacante:** búsqueda, filtros, orden y paginación sin ocultar ningún candidato.
- **Proceso:** nueve estados, cambios solo mediante función auditada (estado anterior/nuevo, responsable, fecha, motivo); observaciones internas. Al abrir una postulación en «Nuevo» o «En revisión», el formulario **preselecciona el estado que sugiere la evaluación** (alta → Preseleccionado; parcial o pendiente → En revisión; baja → No seleccionado). El motivo, en un párrafo, y la observación interna, en lista, se redactan para el estado elegido y se rehacen al cambiarlo. Todo se genera con plantillas a partir de la evaluación más reciente, sin IA ni datos inventados, y es editable. Si el estado elegido no concuerda con la evaluación, se muestra un aviso. El botón «Sugerir a partir de la evaluación» no inserta dos veces el mismo texto.
- **Pedir opinión:** RRHH pide a otra persona de la plataforma que revise una postulación. Esa persona recibe una notificación: la campana del encabezado se pone amarilla con el número de pendientes y aparece un aviso. También la ve en su panel. La solicitud queda respondida cuando registra una observación, y entonces se notifica a quien la pidió.

## Documentación

Índice completo y organización en [docs/README.md](docs/README.md).

| Documento | Contenido |
|---|---|
| [docs/como-funciona.md](docs/como-funciona.md) | Qué hace la plataforma y un caso de uso completo, para quien no conoce el proyecto |
| [docs/roles-y-permisos.txt](docs/roles-y-permisos.txt) | Qué puede hacer cada rol, quién usa la IA y cómo asignar los roles |
| [docs/configuracion-supabase.md](docs/configuracion-supabase.md) | Proyecto, migraciones, Auth, plantillas de correo, primer administrador, Storage |
| [docs/configuracion-ia.md](docs/configuracion-ia.md) | Proveedor de IA, aprobación, costos y minimización de datos |
| [docs/configuracion-correo.md](docs/configuracion-correo.md) | Correo de Auth hoy; Resend en la Etapa 3 |
| [docs/despliegue.md](docs/despliegue.md) | Vercel, entornos separados, variables |
| [docs/metodologia-evaluacion.md](docs/metodologia-evaluacion.md) | Criterios, fórmula, niveles y limitaciones |
| [docs/seguridad.md](docs/seguridad.md) | Controles de seguridad implementados y su ubicación |
| [docs/privacidad-y-legal.md](docs/privacidad-y-legal.md) | Inventario de datos, aviso de privacidad (borrador), derechos ARCO y cuestiones legales a revisar |
| [docs/informe-pruebas.md](docs/informe-pruebas.md) | Pruebas realmente ejecutadas y resultados |
| [docs/pendientes.md](docs/pendientes.md) | Limitaciones conocidas y tareas de la Etapa 4 |
| [docs/arquitectura.md](docs/arquitectura.md) | Estructura del código y decisiones técnicas |

## Aviso

Esta plataforma se diseñó considerando la Ley N.º 29733 y su Reglamento (D. S. N.º 016-2024-JUS), pero **compilar o superar pruebas no acredita cumplimiento legal**. Antes de usar datos reales, la empresa debe completar las revisiones listadas en [docs/privacidad-y-legal.md](docs/privacidad-y-legal.md).
