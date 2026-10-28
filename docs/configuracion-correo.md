# Configuración de correo

## Hoy (Etapa 1)

La aplicación **no envía correos propios**. Los únicos correos son los de Supabase Auth:

- invitación de usuarios internos;
- recuperación de contraseña.

Para producción configure un SMTP propio en Supabase (**Authentication → Emails → SMTP Settings**). Opción recomendada, coherente con el resto del proyecto: **SMTP de Resend**.

1. Cree una cuenta en Resend y **verifique el dominio remitente** (registros SPF y DKIM; recomendable DMARC).
2. Genere una clave con permiso de envío.
3. En Supabase: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = clave de Resend, remitente en el dominio verificado.
4. Envíe una invitación de prueba a una cuenta interna y verifique recepción, remitente y que el enlace lleve a `/auth/confirm`.

No se ha verificado ningún dominio ni credencial de Resend en este entorno.

## Etapa 3 (pendiente)

Módulo de notificaciones a candidatos con Resend desde el servidor:

- plantillas editables (recepción de postulación, entrevista, seleccionado, no seleccionado, feedback, actualización de estado);
- aprobación de RRHH obligatoria antes de entrevistas, resultados y feedback; nunca un rechazo automático por compatibilidad baja;
- bandeja de pendientes/aprobados/enviados/fallidos, previsualización, reintentos controlados y envíos por lote con confirmación de destinatarios;
- claves de idempotencia por mensaje;
- webhooks de Resend para registrar entregado/rebotado/rechazado (no se marcará «entregado» solo porque la API aceptó el envío);
- `EMAIL_DELIVERY_MODE=test` en desarrollo: registra el mensaje sin enviarlo.

Variables reservadas en `.env.example`: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DELIVERY_MODE`.
