# Talento sugerido con el motor y autoagenda — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ordenar la base de talentos de cada vacante con el motor de reglas, y permitir que la persona candidata elija su horario de entrevista entre los que ofrece RRHH.

**Architecture:**
- **Talento:** una función pura ordena el resultado de `evaluateWithRules` por persona, y `matching.ts` arma el grupo evaluado.
- **Autoagenda:** dos tablas (invitaciones y horarios) con funciones `security definer`, sobre un núcleo común de programación de entrevistas. Hay una página pública por token (solo se guarda su hash) y la acción pública lleva límite de uso. El vencimiento corre en la tarea diaria existente.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase/PostgreSQL, Zod, Vitest (unit y db con PGlite), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-talento-y-autoagenda-design.md`

## Global Constraints

- **Talento:**
  - sin IA y sin guardar nada;
  - entran quienes tienen cumplimiento ≥ 40 % o todos los obligatorios cumplidos;
  - máximo 200 personas evaluadas y 20 mostradas.
- **Autoagenda:**
  - de 1 a 6 horarios, todos ≥ 1 h en el futuro;
  - el plazo es anterior al último horario y por defecto queda 2 h antes del primero;
  - una sola invitación pendiente por postulación;
  - el token tiene 32 bytes aleatorios en base64url y la base guarda solo su sha256.
- **Un horario está tomado** si quien hizo la invitación (`created_by`) tiene otra entrevista `programada` que se superpone (`[inicio, inicio + duración)`).
- La página pública muestra solo el puesto, la modalidad, la duración, el lugar y los horarios disponibles.
- Toda Server Action autoriza y valida con Zod. Las funciones SQL son `security definer` con `search_path = ''`, y las de servicio solo tienen `grant` para `service_role`.
- Textos en español, de «usted». Responsivo a 375 y 768 px. `bg-primary` solo en botones.
- **Sin commits** hasta el visto bueno de Omar. Al final, `git commit --only` con rutas explícitas.

## Review Focus

1. **Dos personas eligen el mismo horario a la vez:** solo una lo obtiene y la otra ve que ya no está disponible. → Task 3 (prueba db de horario tomado).
2. **Se abre el enlace después del plazo, o después de que RRHH canceló:** no se puede elegir y la página lo explica. → Task 3 (db) y Task 5 (página).
3. **RRHH programa la entrevista a mano mientras hay una invitación pendiente:** la invitación debe dejar de estar pendiente para no crear una segunda entrevista. → Task 3 (al programar, la pendiente se cancela).
4. **Persona sin correo:** la invitación se crea igual y el diálogo muestra el enlace para copiarlo. → Task 4 (acción) y Task 5 (diálogo).
5. **Base de talentos grande o CV sin texto:** la tarjeta no rompe ni bloquea la página. → Task 2 (prueba de los CV sin texto que se omiten) y Suspense.

---

### Task 1: Ordenamiento puro del talento sugerido

**Files:**
- Create: `src/modules/talent-pool/ranking.ts`
- Test: `tests/unit/talent-ranking.test.ts`

**Interfaces:**
- Produces:
  - `export type RankedTalent = { candidateId: string; score: number; level: Enums<"compatibility_level">; mandatoryMet: number; mandatoryTotal: number; missingMandatory: string[]; accredited: string[] }`
  - `export function rankTalent(entries: { candidateId: string; name: string; requirements: RequirementInput[]; items: ItemAssessment[] }[], limit?: number): RankedTalent[]`, con `limit` 20 por defecto.
  - Usa `computeScores` y `determineLevel` de `evaluation/scoring.ts`.

- [ ] **Step 1: Pruebas.**
  - `it("ordena por obligatorios cumplidos, luego por cumplimiento y luego por nombre")`;
  - `it("deja fuera a quien no llega a 40 % ni cumple todos los obligatorios")`;
  - `it("arma «falta…» con los obligatorios no acreditados, en el orden de la vacante")`;
  - `it("limita a 20")`.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/talent-ranking.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** El mismo comando → PASS.

### Task 2: Evaluar la base de talentos con el motor y mostrarlo

**Files:**
- Modify: `src/modules/talent-pool/matching.ts` (`suggestCandidatesForVacancy`)
- Modify: `src/components/talent/vacancy-suggestions.tsx` (columnas)
- Modify: `src/app/(app)/vacantes/[id]/page.tsx` (tarjeta con `<Suspense>`)
- Test: `tests/unit/talent-ranking.test.ts`, más un caso de la función pura que arma el texto del CV

**Interfaces:**
- Consumes: `rankTalent` (Task 1), `evaluateWithRules`, `loadActiveLearnedRules`.
- Produces: `SuggestedCandidate` suma `score`, `level`, `mandatoryMet`, `mandatoryTotal` y `missingMandatory`. Se quitan `matchCount` y `matchedTerms`.

- [ ] **Step 1: Prueba.** `it("omite los CV sin texto legible y usa el corregido por RRHH si existe")`, sobre `resumeTextOf(extraction)`, una función pura exportada de `ranking.ts`.
- [ ] **Step 2:** FAIL, luego implementar:
  - términos de las descripciones y de las palabras clave;
  - prefiltro por términos (hasta 200 personas, las de más coincidencias);
  - excluir a quien tiene una postulación en curso, ya está en la vacante o está anonimizado;
  - texto del CV vigente; motor; `rankTalent`;
  - consentimiento e invitaciones como hoy.
- [ ] **Step 3:** Interfaz: columnas y descripción de la tarjeta, y la tarjeta en un componente async dentro de `<Suspense>` con esqueleto.
- [ ] **Step 4:** `npx vitest run --project unit`, `npm run typecheck` y eslint → OK. Revisión visual en 3999 a 1366 y 375 px.

### Task 3: Migración de la autoagenda

**Files:**
- Create: `supabase/migrations/20261120200000_autoagenda.sql`
- Create: `tests/db/interview-booking.test.ts`
- Modify: `src/types/database.ts` (`npm run db:types`)

**Interfaces:**
- Produces:
  - las tablas `interview_booking_offers` e `interview_booking_slots`, y el enum `interview_booking_status`;
  - `private.schedule_interview_core(p_application_id, p_scheduled_at, p_duration_minutes, p_modality, p_location, p_interviewers, p_instructions, p_actor uuid) returns uuid`; `public.schedule_interview` queda como envoltorio, con los mismos controles y `p_actor = auth.uid()`;
  - `create_interview_booking(p_application_id uuid, p_slots timestamptz[], p_duration_minutes int, p_modality interview_modality, p_location text, p_interviewers text, p_instructions text, p_interviewer_emails text[], p_expires_at timestamptz, p_token_hash text) returns uuid`;
  - `cancel_interview_booking(p_offer_id uuid) returns void`;
  - `get_interview_booking(p_token_hash text) returns jsonb` (service), con este formato: `{status, vacancy_title, modality, duration_minutes, location, expires_at, scheduled_at, slots: [{id, starts_at}]}`;
  - `book_interview_slot(p_token_hash text, p_slot_id uuid) returns uuid` (service);
  - `expire_interview_bookings() returns integer` (service);
  - `enqueue_system_interview_deep_dive(p_application_id uuid) returns uuid` (service);
  - `notification_kind` suma `agenda_vencida`.
  - Al programar una entrevista a mano (`schedule_interview`), la invitación pendiente de esa postulación pasa a `cancelada`.

- [ ] **Step 1: Pruebas db** (patrón de `tests/db/interview-deep-dives.test.ts`):
  - crea una invitación válida y rechaza: 0 o 7 horarios, un horario pasado, el plazo después del último horario, una segunda invitación pendiente y una postulación cerrada;
  - agendar crea la entrevista `programada`, deja la postulación en `entrevista_programada` y pone `created_by` y el actor en quien invitó;
  - no se puede agendar: un horario ajeno, una invitación vencida o cancelada, ni un horario tomado por otra entrevista de quien invitó;
  - `get_interview_booking` solo devuelve horarios disponibles;
  - el vencimiento marca `vencida` y deja una notificación `agenda_vencida` a quien invitó;
  - programar a mano cancela la invitación pendiente;
  - permisos: anónimo no; el personal no usa las funciones de servicio.
- [ ] **Step 2:** FAIL, luego escribir la migración. Las pruebas existentes de entrevistas (`tests/db/interviews.test.ts`, `interview-reminders.test.ts`) deben seguir pasando.
- [ ] **Step 3:** Aplicar en local (`psql -1`, `migration repair`, `npm run db:types`) y correr `npm run typecheck`.

### Task 4: Servidor de la autoagenda

**Files:**
- Create: `src/modules/interviews/booking.ts`: `createBookingToken()` devuelve `{ token, hash }`, `bookingUrl(token)` y `bookingSchema`, con pruebas.
- Create: `src/modules/notifications/email/templates/interview-booking.ts`: correo con el enlace y los horarios.
- Modify: `src/modules/interviews/actions.ts`:
  - `inviteToBook(input): Promise<ActionResult<{ url: string; emailed: boolean }>>`;
  - `cancelBooking(offerId)`.
- Create: `src/modules/interviews/booking-public.ts`:
  - `getPublicBooking(token)`;
  - la acción `bookSlot(token, slotId)`, con el límite público y el cliente de servicio. Después: correos `invitation` y `enqueue_system_interview_deep_dive`.
- Modify: `src/app/api/tareas/recordatorios-entrevista/route.ts` (o la función de la tarea), para llamar a `expire_interview_bookings`.
- Test: `tests/unit/interview-booking.test.ts` (token y hash, esquema, correo con horarios en hora de Lima y sin datos ajenos).

- [ ] Pruebas → FAIL → implementar → PASS. Correr la suite unitaria completa y el typecheck.

### Task 5: Interfaz de la autoagenda

**Files:**
- Create: `src/components/interviews/booking-dialog.tsx`: diálogo «Invitar a agendar», con 1 a 6 filas de fecha y hora, los mismos campos que «Programar entrevista» y «Puede elegir hasta».
- Modify: `src/app/(app)/postulaciones/[id]/page.tsx`, tarjeta «Entrevistas»:
  - el botón;
  - el estado de la invitación (pendiente, con «Copiar enlace» y «Cancelar», o vencida).
- Create: `src/app/agendar/[token]/page.tsx`: página pública y responsiva, con un formulario de elección y una confirmación.
- Modify: `src/proxy.ts` (`PUBLIC_PATHS`, con `/agendar`).
- Modify: la etiqueta de la campana para `agenda_vencida`.
- Test: `tests/e2e/autoagenda.spec.ts`:
  - RRHH invita con 2 horarios;
  - la tarjeta muestra la invitación pendiente;
  - se abre el enlace (que muestra el diálogo, sin correo);
  - se elige un horario;
  - queda la entrevista programada y la invitación desaparece de la tarjeta.

- [ ] E2E → implementar → E2E en el stack aislado → PASS. Revisión visual a 375 px.

### Task 6: Documentación, demo y revisión

- [ ] `docs/como-funciona.md`: talento sugerido y autoagenda. `docs/pendientes.md`: la opción B queda como siguiente paso.
- [ ] Recompilar la demo y hacer un recorrido real en desarrollo con una persona **sin correo**, para no enviar correos.
- [ ] Revisión final de toda la rama con un revisor nuevo y una pasada de correcciones con pruebas.
- [ ] Informar a Omar y esperar su visto bueno para el commit y el push.
