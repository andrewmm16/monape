# Talento sugerido con el motor y autoagenda de entrevistas

Fecha: 20/11/2026 · Enfoques elegidos por Omar: talento sugerido «opción 1» y autoagenda «opción A, preparada para pasar a la B».

## 1. Talento sugerido con el motor

### Para qué

Ya existe la tarjeta «Candidatos de la base de talentos que encajan» en la vacante (`talent-pool/matching.ts`). Hoy elige y ordena por **coincidencia de palabras**: cuenta cuántas palabras de los requisitos aparecen en el CV. Quien menciona «Excel» de pasada puede quedar por encima de quien cumple. El objetivo es evaluar a la base de talentos **con el mismo motor de reglas de las postulaciones** y mostrar a cada persona con su cumplimiento, sus obligatorios y el porqué. Así RRHH reactiva a quien de verdad encaja.

### Decisiones

- **Cuándo:** se calcula al abrir la vacante. Sin aviso automático por ahora (opción 2, futura; reutilizaría el mismo cálculo).
- **No gasta IA:** solo el motor de reglas (`evaluateWithRules`, local), con las reglas aprendidas activas (`loadActiveLearnedRules`).
- **No guarda nada:** no crea postulaciones ni evaluaciones; solo ordena. Agregar o invitar sigue como hoy, y para invitar hace falta el consentimiento de cartera.

### Diseño

- **Grupo evaluado:** personas sin postulación en curso, que no están ya en esta vacante, no anonimizadas y con CV vigente con texto (≥ 50 caracteres; el corregido por RRHH si existe).
  - Para acotar el costo se prefiltra con la búsqueda actual por términos. Los términos salen de las descripciones **y de las palabras clave** de los requisitos.
  - Se evalúan como máximo 200 personas (las de más coincidencias).
- **Por persona:** `evaluateWithRules`, luego `computeScores` y el nivel (`determineLevel`), con la misma metodología que una postulación.
- **Entran:** quienes tienen cumplimiento ≥ 40 % (el corte de «parcial») o cumplen todos los obligatorios.
- **Orden:** primero los obligatorios cumplidos, luego el cumplimiento y luego el nombre. Se muestran hasta 20.
- **Interfaz:** la misma tarjeta, con columnas Nombre · Cumplimiento (%, con la insignia de nivel de siempre) · Obligatorios («3 de 4 · falta «Excel avanzado»») · Consentimiento.
  - La descripción dice que se evaluó con el motor frente a los requisitos de esta vacante.
  - La tarjeta carga aparte (`<Suspense>`) para no demorar la página.
- **Código:** la parte pura (ordenar, filtrar y armar «falta…») va en `talent-pool/ranking.ts` con pruebas. La consulta y la evaluación van en `matching.ts`.

## 2. Autoagenda de entrevistas (opción A, preparada para la B)

### Para qué

Hoy RRHH fija la fecha y la hora de cada entrevista. Con la autoagenda, RRHH ofrece de 1 a 6 horarios, la persona elige uno desde un enlace y la entrevista se crea sola. Se acaban las idas y vueltas para coordinar.

### Opción A ahora, B después

- **A (ahora):** RRHH escribe los horarios para cada persona.
- **B (después):** RRHH define una disponibilidad semanal y la app genera los horarios.
- En los dos casos los horarios son filas concretas (`interview_booking_slots`), y la elección, la creación de la entrevista y los avisos son los mismos. Pasar a la B solo agrega quien **genera** los horarios.
- Para que dos personas no tomen la misma hora, un horario se considera **tomado** si quien hizo la invitación ya tiene una entrevista programada que se superpone, aunque venga de otra invitación. Ese es el mismo control que necesitará la B.

### Datos (migración `20261120200000_autoagenda.sql`)

- **`interview_booking_offers`:**
  - qué es: `id`, `application_id` (cascada), `created_by`, `token_hash` (sha256 del enlace, único);
  - cómo será la entrevista: `duration_minutes`, `modality`, `location`, `interviewers`, `interviewer_emails text[]`, `instructions`;
  - plazo y resultado: `expires_at`, `status` (`pendiente` | `agendada` | `vencida` | `cancelada`), `interview_id`, `decided_at`, `created_at`.
  - Un solo `pendiente` por postulación.
- **`interview_booking_slots`:** `id`, `offer_id` (cascada) y `starts_at`, con `unique (offer_id, starts_at)`.
- **RLS:** el personal con acceso a la postulación puede leer. Nadie escribe directo.
- **Funciones** (`security definer`, `search_path = ''`):
  - `create_interview_booking(...)` (personal). Valida:
    - de 1 a 6 horarios, todos al menos 1 h en el futuro y sin repetir;
    - que el plazo sea anterior al último horario;
    - que la postulación no esté cerrada y la vacante no esté archivada;
    - que no haya otra invitación pendiente (RH409).
    - Los campos se revisan con `check_interview_fields`. El token lo genera la app y llega aquí solo su hash.
  - `cancel_interview_booking(p_offer_id)` (personal).
  - `get_interview_booking(p_token_hash)` (solo `service_role`): devuelve el puesto, la modalidad, la duración, el lugar, el estado y los horarios **disponibles** (futuros y no tomados).
  - `book_interview_slot(p_token_hash, p_slot_id)` (solo `service_role`):
    - bloquea la invitación y comprueba que esté pendiente, sin vencer, que el horario sea suyo, futuro y no tomado;
    - crea la entrevista con el mismo núcleo que `schedule_interview`, que se refactoriza en `private.schedule_interview_core(..., p_actor)` y deja `schedule_interview` como envoltorio con los mismos controles;
    - deja `created_by` y el actor del historial en quien hizo la invitación y guarda los correos de los entrevistadores;
    - marca la invitación como `agendada`.
  - `expire_interview_bookings()` (solo `service_role`): marca como `vencida` lo que pasó su plazo y deja un aviso en la campana de quien invitó (nuevo `notification_kind` `agenda_vencida`).
  - `enqueue_system_interview_deep_dive(p_application_id)` (solo `service_role`): para que una entrevista agendada por la persona también encole las preguntas para profundizar.

### Flujo

1. **RRHH:** en la postulación, tarjeta «Entrevistas», botón «Invitar a agendar» junto a «Programar entrevista». Abre un diálogo con:
   - de 1 a 6 fechas y horas;
   - duración, modalidad, lugar, entrevistadores, sus correos e indicaciones;
   - «Puede elegir hasta», que por defecto es 2 horas antes del primer horario.
2. **Al enviar:** se genera el token, se crea la invitación y se envía el correo con el enlace `${APP_URL}/agendar/<token>` y los horarios. Si la persona no tiene correo, el diálogo muestra el enlace para copiarlo.
3. **Mientras está pendiente:** la tarjeta lo muestra («Invitación a agendar: 3 horarios, puede elegir hasta …») con los botones «Copiar enlace» y «Cancelar».
   - Si vence: «No eligió horario (venció el …)», y el aviso llega a la campana.
   - Si la persona elige: la entrevista aparece como cualquier otra.
4. **La persona:** abre `/agendar/<token>`, una página pública (se agrega a `PUBLIC_PATHS` en `proxy.ts`) que funciona sin sesión y está adaptada al celular.
   - Ve el puesto, la modalidad, la duración y los horarios en hora de Lima, elige uno y lo confirma.
   - La acción del servidor aplica el límite público (`consume_public_rate_limit`) y llama a `book_interview_slot`.
   - Después se envía el correo de entrevista de siempre (`invitation`) a la persona y a los entrevistadores, con el recordatorio de siempre, y se encolan las preguntas para profundizar.
   - Sin horarios disponibles, o con la invitación vencida o cancelada, la página lo explica y no ofrece nada.
5. **Vencimiento:** `expire_interview_bookings()` corre dentro de la tarea diaria existente `/api/tareas/recordatorios-entrevista`.

### Seguridad y privacidad

- El enlace no lleva datos personales: es un token aleatorio de 32 bytes, y la base guarda solo su hash.
- La página pública muestra solo el puesto, la modalidad, el lugar y los horarios; nunca el nombre ni los datos de otras personas.
- La acción pública no confía en el cliente: valida el token y el horario en la base, dentro de una transacción.
- La anonimización no necesita cambios: las invitaciones no guardan textos del CV, y los correos ya enviados no se pueden recuperar.

### Pruebas

- **Base de datos:**
  - crear, validar y cancelar;
  - una sola invitación pendiente;
  - agendar (crea la entrevista, cambia el estado y deja el actor);
  - no se puede agendar un horario tomado, vencido, ajeno o pasado;
  - vencimiento con su aviso;
  - permisos (anónimo no puede; el personal no puede usar las funciones de servicio).
- **Unitarias:** el armado del correo y la validación de la acción.
- **E2E:**
  - RRHH invita con 2 horarios y la tarjeta muestra la invitación pendiente;
  - la página pública con el token permite elegir y queda la entrevista programada.
  - El correo no se envía en el entorno de pruebas (Resend sin clave).

### Fuera de alcance

- La opción B (disponibilidad semanal) y la integración con Google u Outlook.
- Que la persona reprograme sola.
- Avisos por WhatsApp.
