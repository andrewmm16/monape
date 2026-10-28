# Configuración de Supabase

Use **proyectos separados** para desarrollo, pruebas y producción. Nunca cargue datos reales en desarrollo o pruebas.

## 1. Crear el proyecto

1. Cree un proyecto en [supabase.com](https://supabase.com). Elija la región considerando la ubicación de los datos (es una transferencia internacional: ver [privacidad-y-legal.md](privacidad-y-legal.md)).
2. En **Project Settings → API Keys** obtenga:
   - la clave **publishable** (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
   - la clave **secret** (`sb_secret_…`) → `SUPABASE_SECRET_KEY` (solo servidor).
   Si el proyecto usa claves heredadas, la `anon` y la `service_role` funcionan en las mismas variables.
3. URL del proyecto → `NEXT_PUBLIC_SUPABASE_URL`.

## 2. Aplicar las migraciones

Las migraciones están en `supabase/migrations/` y deben aplicarse **en orden**:

| Archivo | Contenido |
|---|---|
| `…000100_foundation.sql` | Roles de aplicación, perfiles, funciones de autorización, auditoría, límites de solicitudes |
| `…000200_vacancies.sql` | Vacantes, requisitos ponderados, aprobación de criterios (y equipos de vacante, eliminados en `20261023000500`) |
| `…000300_candidates.sql` | Candidatos, CV, extracciones, perfil profesional, postulaciones e historial |
| `…000400_evaluations.sql` | Evaluaciones, ítems con evidencias, vista de candidatos por vacante, panel |
| `…000500_storage.sql` | Bucket privado `resumes` (sin acceso directo de usuarios) |
| `20261023000100_one_active_application.sql` | Una postulación en proceso por candidato |
| `20261023000200_user_trash.sql` | Papelera de usuarios y perfiles históricos de cuentas eliminadas |
| `20261023000300_opinion_requests.sql` | Pedir opinión y notificaciones |
| `20261023000400_opinion_any_evaluator.sql` | Pedir opinión a evaluadores fuera del equipo (superada por la siguiente) |
| `20261023000500_remove_evaluator_role.sql` | Elimina el rol evaluador y los equipos de vacante. **Falla a propósito si queda alguna cuenta vigente con rol evaluador**: elimínela antes desde la papelera |

Opción A — Supabase CLI (no requiere Docker para un proyecto remoto):

```bash
npx supabase login
npx supabase link --project-ref <ID_DEL_PROYECTO>
npx supabase db push        # aplica las migraciones pendientes
```

Opción B — **SQL Editor** del panel: ejecute cada archivo completo en orden.

Desarrollo local con Docker: `npx supabase start` aplica las migraciones y usa `supabase/config.toml` (registro público deshabilitado, contraseñas de 12+ caracteres, plantillas de correo).

> Las migraciones se probaron en PostgreSQL 18 (PGlite) y en el stack local de Supabase (PostgreSQL 17.11, `supabase start`); **no** se han ejecutado aún contra un proyecto en la nube. Confírmelas en el proyecto de pruebas antes de producción.
>
> En `config.toml`, `[auth.email] enable_signup` debe quedar en `true`: en la CLI esa clave habilita el proveedor de correo, y en `false` también impide iniciar sesión. El registro público se bloquea con `[auth] enable_signup = false`.

Tras aplicarlas, regenere los tipos con el generador oficial si lo desea:

```bash
npx supabase gen types typescript --project-id <ID> > src/types/database.ts
```

(`npm run db:types` produce un archivo equivalente sin conexión, a partir de las migraciones.)

## 3. Autenticación

En **Authentication → Sign In / Providers**:

- **Desactive "Allow new users to sign up"** (la plataforma no tiene registro público).
- Deje habilitado solo *Email*; desactive el inicio de sesión anónimo.
- Longitud mínima de contraseña: 12. Requisitos: letras y dígitos.

En **Authentication → URL Configuration**:

- *Site URL*: la URL de la aplicación (igual a `APP_URL`).
- *Redirect URLs*: `https://<su-dominio>/auth/confirm` (y `http://localhost:3000/auth/confirm` solo en desarrollo).

En **Authentication → Emails → Templates**, reemplace las plantillas *Invite user* y *Reset password* por las de `supabase/templates/` (usan `token_hash`, necesario para el flujo en el servidor):

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/restablecer">…</a>
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/restablecer">…</a>
```

**SMTP:** el servicio de correo incorporado de Supabase tiene límites estrictos y no es apto para producción. Configure un SMTP propio (por ejemplo, el SMTP de Resend con un dominio verificado) en **Authentication → Emails → SMTP Settings**. Ver [configuracion-correo.md](configuracion-correo.md).

## 4. Primer administrador

Como no hay registro público, el primer administrador se crea manualmente:

1. **Authentication → Users → Add user → Create new user** (correo corporativo; marque *Auto confirm*). Su perfil se crea **desactivado**: una cuenta creada fuera de la plataforma no tiene acceso hasta que se le asigna un rol.
2. En el **SQL Editor**:

   ```sql
   update public.profiles set role = 'admin', is_active = true, full_name = 'Nombre Apellido'
   where email = 'persona@empresa.pe';
   ```

3. Esa persona ingresa y, desde **Usuarios**, invita al resto con su rol.

El rol solo puede cambiarlo un administrador; la base de datos impide dejar el sistema sin administradores activos.

## 5. Storage

La migración `…000500_storage.sql` crea el bucket **privado** `resumes` (4 MB, solo PDF y DOCX) **sin políticas para usuarios**: nadie puede leer, firmar, subir ni borrar archivos con su sesión. El servidor de la aplicación accede con `SUPABASE_SECRET_KEY` después de autorizar, validar y (en descargas) auditar. Verifique en **Storage** que el bucket figure como *Private* y **no cree políticas** para él.

## 6. Copias de seguridad y recuperación

- Plan gratuito: copias diarias limitadas. Para producción evalúe un plan con **Point-in-Time Recovery**.
- Los archivos de Storage no se incluyen en los respaldos de la base de datos: defina una copia periódica del bucket si la política de conservación lo exige.
- Documente y pruebe el procedimiento de restauración en el proyecto de pruebas (pendiente, ver [pendientes.md](pendientes.md)).

## 7. Comprobaciones antes de usar datos reales

- [ ] Registro público deshabilitado.
- [ ] Bucket `resumes` privado.
- [ ] RLS habilitado en todas las tablas (*Database → Tables*; la prueba `migraciones` lo verifica en PGlite).
- [ ] Plantillas de correo con `token_hash` y SMTP propio.
- [ ] `SUPABASE_SECRET_KEY` solo en variables de servidor de Vercel.
- [ ] Prueba E2E `tests/e2e/flujo-rrhh.spec.ts` ejecutada contra el proyecto de pruebas.
