# Configuración de correo

Estado al 18/11/2026.

## Correos de la aplicación (Resend)

La aplicación envía sus propios correos con Resend, desde el servidor (`src/modules/notifications/email/`):

| Correo | Destinatario | Cuándo |
|---|---|---|
| Acuse de postulación | Persona candidata | Al postular por el formulario público |
| Cambio de estado (entrevista, seleccionado, no seleccionado) | Persona candidata | Cuando RRHH guarda el cambio. Usa las plantillas editables de «Configuración → Plantillas de correo» |
| Entrevista agendada, reprogramada o cancelada | Persona candidata y **entrevistadores** con correo | Al agendar, reprogramar o cancelar. Los correos de los entrevistadores se escriben en el formulario de la entrevista |
| Recordatorio de entrevista | Persona candidata y entrevistadores | Tarea programada diaria (`/api/tareas/recordatorios-entrevista`, ver [despliegue.md](despliegue.md#tareas-programadas-cron)). Sale una vez por entrevista, fecha y destinatario |
| Invitación de la base de talentos | Candidatos del histórico | Desde la vacante, «Invitar por correo». Exige el buzón de respuestas configurado |
| Mensaje a la persona candidata | Persona candidata | Desde la postulación |

Con el **portal del candidato** encendido («Configuración → Portal del candidato»), los correos a la persona candidata (acuse, cambios de estado y entrevistas) llevan al final su enlace de seguimiento. El enlace es el mismo en todos sus correos; desde la ficha se puede renovar si se envió a quien no correspondía. Los enlaces se arman con `APP_URL`.

Variables (ver `.env.example`):
- `EMAIL_DELIVERY_MODE=test` (por defecto): no se envía nada. Así corren el desarrollo y las pruebas.
- `EMAIL_DELIVERY_MODE=live`: envío real. Exige `RESEND_API_KEY` y `EMAIL_FROM`.

Los registros del servidor guardan solo identificadores y el estado del envío, nunca la dirección ni el contenido.

### Pendiente para producción

1. **Verificar el dominio remitente en Resend** (registros SPF y DKIM; recomendable DMARC). Con el remitente de pruebas `onboarding@resend.dev`, Resend solo entrega a la dirección de la cuenta dueña, así que a los candidatos no les llega nada.
2. Definir `EMAIL_FROM` con ese dominio, por ejemplo `RRHH <rrhh@dominio-verificado>`.
3. Configurar el **buzón de respuestas** en «Configuración → Plantillas de correo», porque las invitaciones piden responder.

## Correos de Supabase Auth

Invitación de usuarios internos y recuperación de contraseña. Para producción, configure un SMTP propio en Supabase (**Authentication → Emails → SMTP Settings**). La opción coherente con lo anterior es el **SMTP de Resend**:

1. Use el mismo dominio verificado.
2. En Supabase: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = clave de Resend y remitente en el dominio verificado.
3. Envíe una invitación de prueba a una cuenta interna y verifique la recepción, el remitente y que el enlace lleve a `/auth/confirm`.

## Ideas no implementadas

- Webhooks de Resend para registrar entregado, rebotado o rechazado. Hoy «enviado» significa que la API aceptó el envío.
- Bandeja de envíos con aprobación previa y reintentos manuales.
