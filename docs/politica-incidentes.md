# Política de incidentes de seguridad

**Versión 1 · 18/11/2026.** Qué hacer si algo sale mal con la plataforma de reclutamiento: quién decide, qué se hace primero, a quién hay que avisar y en qué plazo. Está escrita para usarse en el momento, no solo para leerse.

## 1. Alcance y responsables

Cubre la aplicación web (Vercel), la base de datos y los archivos (Supabase), el robot de portales y el worker de IA (la PC del robot), el correo (Resend) y la IA (Claude). Los datos más delicados son los **CV y los datos de contacto de las personas candidatas**.

| Rol | Quién | Qué hace |
|---|---|---|
| Responsable del incidente | Administración de la plataforma (hoy, Omar) | Decide, coordina y registra. Puede apagar partes de la plataforma sin pedir permiso. |
| Oficial de datos personales | Quien designe la empresa (si aún no hay, Gerencia) | Decide y firma las notificaciones a la autoridad y a las personas afectadas. |
| RRHH | Equipo usuario | Avisa de lo raro que vea y sigue las indicaciones (por ejemplo, no abrir un archivo). |

Cualquier persona que sospeche un incidente **avisa de inmediato** al responsable, aunque no esté segura. Un falso aviso no cuesta nada; uno tardío, sí.

## 2. Qué es un incidente y qué tan grave es

| Gravedad | Ejemplos | Primera respuesta |
|---|---|---|
| **Alta** | CV o datos de candidatos vistos o descargados por alguien sin permiso; una cuenta de RRHH o de administración usada por otra persona; una clave secreta publicada (por ejemplo, en GitHub o en un chat); borrado o alteración masiva de datos | En menos de 1 hora |
| **Media** | Un archivo sospechoso abierto en una PC de RRHH; abuso del formulario público (cientos de postulaciones falsas); el robot entrando a un portal con credenciales expuestas | En el mismo día |
| **Baja** | Caída temporal de la app, del robot o de la IA; correos que no salen; un aviso de la vigilancia semanal de la IA | Al siguiente día hábil |

## 3. Cómo se detecta

- **Auditoría** (menú «Auditoría», solo administración): altas, cambios, bajas y cada descarga de CV, con quién y cuándo. Es inmutable.
- **Avisos automáticos por correo a administración:** el worker de IA sin sesión de Claude o sin programa, y la vigilancia semanal de la IA.
- **Panel y estado del robot:** caídas del robot o del worker.
- **Registros de Vercel y Supabase:** errores del servidor y accesos a la base.
- **Personas:** RRHH, candidatos que reciben algo raro o el proveedor (Supabase, Vercel, Resend, Anthropic) que avisa de un problema.

## 4. Qué hacer, paso a paso

1. **Contener (primera hora en gravedad alta).** Cortar el daño antes de investigar, usando los procedimientos del punto 6: desactivar la cuenta, rotar la clave, apagar la parte afectada. Se apaga primero y se pregunta después.
2. **Preservar la evidencia.** No borrar registros. Exportar lo relevante de la auditoría y anotar la hora de cada acción.
3. **Evaluar el alcance.** Qué datos, de cuántas personas, desde cuándo, si eran datos sensibles y si siguen expuestos. La auditoría de descargas responde casi siempre quién vio qué CV.
4. **Notificar** dentro de los plazos legales (punto 5). El reloj corre **desde que se toma conocimiento**, no desde que se termina de investigar.
5. **Recuperar.** Volver a encender lo apagado con la causa corregida. Si se perdieron o alteraron datos, restaurar según [respaldo-y-restauracion.md](respaldo-y-restauracion.md).
6. **Cerrar y aprender.** Hacer la revisión en un plazo de 5 días hábiles (punto 7).

## 5. A quién avisar y en qué plazo (Perú)

El Reglamento de la Ley 29733 (Decreto Supremo 016-2024-JUS, vigente desde fines de marzo de 2025) exige, ante un incidente que afecte datos personales:

- **Autoridad Nacional de Protección de Datos Personales:** notificar **dentro de las 48 horas** desde que se toma conocimiento, aunque el incidente ya se haya resuelto internamente.
- **Personas afectadas:** informarles sin demora indebida, en el mismo plazo, en lenguaje claro: qué pasó, qué datos y qué pueden hacer.
- **Centro Nacional de Seguridad Digital:** si el incidente ocurrió en un entorno digital.

Antes de enviar, el oficial de datos personales confirma con asesoría legal qué artículo aplica y en qué supuestos es obligatoria la notificación (las fuentes difieren en los detalles). Fuentes: [El Peruano](https://www.elperuano.pe/noticia/259141--peru-fortalece-la-proteccion-de-datos-estos-son-los-principales-cambios-del-nuevo-reglamento), [Garrigues](https://www.garrigues.com/es_ES/noticia/peru-publica-nuevo-reglamento-ley-proteccion-datos-personales), [CMS (infografía de notificación)](https://cms.law/content/download/705947/file/Infografia%20TMC%20-%20Notificacion%20de%20incidentes%20de%20seguridad.pdf).

Además, se avisa al proveedor involucrado (Supabase, Vercel, Resend, Anthropic o el portal de empleo) si el problema está de su lado o si hay que pedirle registros.

## 6. Procedimientos rápidos

**Una cuenta comprometida.** En «Usuarios», desactivar la cuenta, lo que corta el acceso al instante aunque tenga la sesión abierta: la app y la base solo reconocen cuentas activas. En Supabase (Authentication → Users), cerrar sus sesiones y forzar el cambio de contraseña. Revisar en «Auditoría» qué hizo desde la hora sospechosa, sobre todo las descargas de CV.

**Una clave secreta expuesta.** Se rota siempre: generar una nueva, reemplazarla y volver a desplegar. Que la clave vieja «no la haya visto nadie» no basta.

| Secreto | Dónde vive | Cómo se rota |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Vercel | Supabase → Project Settings → API keys: crear una nueva y revocar la anterior |
| `AI_WORKER_SECRET` / `IA_WORKER_SECRET` | Vercel y `.env.ia-worker` de la PC del robot | Generar uno nuevo (32 caracteres o más), el mismo valor en los dos lados, y reiniciar el worker |
| `CLAUDE_CODE_OAUTH_TOKEN` | `.env.ia-worker` | `claude setup-token` para generar uno nuevo; revocar el anterior desde la cuenta de Claude |
| `RESEND_API_KEY` | Vercel | Panel de Resend: crear una clave nueva y borrar la anterior |
| `PORTAL_BOT_SECRET`, `CRON_SECRET`, `EVALUATION_WEBHOOK_SECRET`, `TALENT_APPLY_SECRET`, `TALENT_FEED_TOKEN` | Vercel (y el robot o el portal que la usa) | Generar una nueva y actualizarla en los dos extremos ([configuracion-talent.md](configuracion-talent.md) en el caso de Talent.com) |
| `INTAKE_HASH_SECRET` | Vercel | Generar una nueva (firma el desafío antirrobots del formulario público). Quien esté postulando en ese momento tendrá que reintentar |
| Usuario y clave de un portal de empleo | Configuración del robot | Cambiar la clave en el portal y luego en el robot |

**Un archivo sospechoso.** No abrirlo. Si ya se abrió, desconectar esa PC de la red y pasarle el antivirus. Borrar el CV de la ficha del candidato y anotar de qué portal llegó. La app ya rechaza PDF con scripts y Word con macros, y nunca ejecuta los archivos en el servidor, así que el riesgo está en abrirlo en una PC.

**Apagar partes sin tocar código** (variable en Vercel y volver a desplegar):
- IA: `AI_PROVIDER=none` o `AI_EXTERNAL_PROCESSING_APPROVED=false`. El motor de reglas sigue evaluando.
- Página pública de empleos y feed: `PUBLIC_JOBS_ENABLED=false`.
- Portal del candidato: «Configuración → Portal del candidato → Apagar». Los enlaces ya enviados dejan de mostrar datos.
- Worker de IA o robot: detener su tarea en la PC del robot.
- Toda la app: pausar el proyecto en Vercel. Es el último recurso.

**Datos borrados o alterados.** Restaurar el respaldo según [respaldo-y-restauracion.md](respaldo-y-restauracion.md) y reconstruir lo posterior con la auditoría.

## 7. Registro y revisión

Cada incidente, incluso los falsos avisos, se anota en un registro que lleva el responsable (una hoja compartida solo con administración):

- fecha y hora en que se detectó y quién lo detectó;
- qué pasó y qué datos afectó (cuántas personas, si hubo datos sensibles);
- gravedad;
- acciones tomadas y a qué hora;
- notificaciones enviadas (a quién y cuándo);
- causa y qué se cambió para que no se repita.

En los 5 días hábiles siguientes a un incidente de gravedad media o alta, se hace una revisión breve y sin culpables (qué pasó, qué funcionó, qué no) y se actualiza este documento si hace falta.

## 8. Práctica

Una vez al año, y antes de pasar a producción, se hace un simulacro de mesa de 30 minutos. Caso sugerido: «la clave del worker de IA apareció en un chat». Se recorren los pasos, se cronometra la rotación y se corrige lo que no esté claro.
