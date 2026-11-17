# CRM / base de talentos — diseño

**Fecha:** 2026-11-17 · **Estado:** propuesto (pendiente de aprobación)

## Intención y porqué

Hoy un candidato "vive" atado a la vacante por la que postuló: cuando esa vacante
se cierra, su información queda enterrada en el histórico y no se reutiliza. El
caso más claro es el **finalista que no quedó**: una persona ya entrevistada y
evaluada que, al abrir una vacante similar, habría que volver a buscar desde
cero.

El objetivo es convertir el histórico de candidatos en una **base de talentos
reutilizable**: poder **etiquetar/agrupar** candidatos y **reactivarlos** (meterlos
en una vacante nueva) sin recapturarlos, respetando el consentimiento de datos
que ya maneja la plataforma. Es el segundo de los dos features acordados (el
primero, la evaluación colaborativa, ya está hecho) y el de mayor retorno frente
a la paridad con Pandapé.

## Objetivos

- **Etiquetas compartidas** del equipo de RRHH: crear, asignar y quitar etiquetas
  a candidatos (p. ej. "finalista", "Python senior", "recontratar").
- **Filtrar el pool por etiqueta**, combinado con los filtros que ya existen.
- **Reactivar**: añadir un candidato del histórico a una vacante nueva en un paso,
  reutilizando su CV vigente, sin duplicar si ya postuló a esa vacante.
- **Estado de consentimiento** de cartera de talento visible como señal (no
  bloquea).
- Todo autorizado y auditado, con RLS en las tablas nuevas.

## No objetivos

- No hay captura masiva ni importación nueva de candidatos (el sourcing ya existe
  en `caleta`/`mercado`).
- No se construye un consentimiento nuevo: se usa el que ya existe
  (`consent_records`, propósito `cartera_talento`).
- No se tocan el motor de evaluación ni el flujo de entrevistas.
- No hay campañas/envíos masivos desde el pool (posible fase posterior).

## Anti-objetivos (qué sería un fracaso aunque "funcione")

- Que reactivar cree postulaciones duplicadas o rompa la unicidad
  `(candidate_id, vacancy_id)`.
- Que las etiquetas se vuelvan un basurero privado por usuario sin valor
  colaborativo.
- Que el reuso de datos personales ocurra sin dejar rastro auditable.

## Restricciones

- Next.js 16 (App Router, Server Actions), RLS en todas las tablas, validación Zod
  en el servidor, Storage/consentimiento gestionados como ya se hace.
- La tabla `applications` ya tiene `unique (candidate_id, vacancy_id)` y un enum
  `application_intake_method` (con valor `manual`).
- **Regla existente "una postulación en proceso por candidato"** (trigger
  `applications_one_in_process`): un candidato no puede estar en proceso en dos
  vacantes a la vez. "En proceso" = `nuevo, en_revision, preseleccionado,
  entrevista_programada, en_evaluacion`. Reactivar solo procede sobre candidatos
  con su proceso **cerrado** (no seleccionado, seleccionado, retirado, en reserva,
  o vacante archivada) — justo el caso del finalista que no quedó. El RPC se apoya
  en este trigger: si el candidato sigue activo en otra vacante, falla con un
  mensaje claro.
- El consentimiento ya existe: `privacy_notices` (avisos versionados),
  `consent_records` + `private.record_consent` / `revoke_consent`, con el propósito
  `cartera_talento`.
- Permiso relevante: `candidates:manage` (la página `candidatos/buscar` ya lo
  exige).

## Enfoque

**Vía elegida: extender lo existente.** Se amplían el módulo `talent-pool` y la
página `candidatos/buscar` con tablas de etiquetas y un RPC de reactivación. No se
crea un subsistema nuevo porque duplicaría el buscador, la RLS y el modelo de
candidatos que ya funcionan.

Alternativas descartadas:
- *Módulo "pool" independiente con su propio modelo de candidatos* → duplicaría
  datos y RLS; descartado.
- *Etiquetas privadas por usuario* → va contra el objetivo colaborativo; se eligen
  **compartidas**.
- *Consentimiento bloqueante* (impedir reactivar sin consentimiento vigente) →
  descartado a favor de **informativo**: se muestra el estado pero no frena el
  reuso (decisión del usuario).

## Modelo de datos (tablas nuevas)

**`public.talent_tags`** — etiquetas compartidas:
- `id uuid pk`
- `name text not null` — único sin distinguir mayúsculas/acentos; 1–40 caracteres.
- `color text null` — opcional, de una lista fija para la UI (decisión del builder;
  puede omitirse en v1).
- `created_by uuid → profiles`, `created_at`, `updated_at`.

**`public.candidate_tags`** — asignación N:M:
- `candidate_id uuid → candidates on delete cascade`
- `tag_id uuid → talent_tags on delete cascade`
- `assigned_by uuid → profiles`, `created_at`
- `unique (candidate_id, tag_id)`.

Ambas con trigger de auditoría (`private.audit_row_change`) y, donde aplique,
`private.set_updated_at`.

## RPC de reactivación

**`public.add_candidate_to_vacancy(p_candidate_id uuid, p_vacancy_id uuid)`**
(`security definer`):
- Autoriza: `private.is_staff()` (equivale a `candidates:manage`).
- Valida que la vacante admita postulaciones (no archivada/cerrada); reutiliza las
  reglas del trigger `applications_check_vacancy`.
- Si ya existe postulación `(candidato, vacante)` → error `RH409` legible ("Ya tiene
  una postulación en esa vacante"), sin duplicar.
- Toma el CV vigente del candidato (`resumes.is_current`) como `resume_id` (puede ser
  nulo si no tiene CV).
- Inserta la postulación en estado `nuevo`, con `intake_method = 'cartera'` (valor
  nuevo del enum `application_intake_method`, para distinguir en la bandeja y los
  reportes el origen "base de talentos"). El trigger existente registra el evento
  `postulacion_creada`.
- Devuelve el `application_id`.

## Consentimiento (informativo)

- Una consulta deriva, por candidato, el estado de la cartera de talento a partir de
  `consent_records` (propósito `cartera_talento`): **consiente**, **revocó** o **sin
  constancia** (la forma exacta la resuelve el builder leyendo la tabla).
- Se muestra como distintivo en el pool y en la ficha, y como aviso al reactivar. No
  bloquea ninguna acción.

## Permisos y RLS

- `talent_tags`: `select` para staff; `insert/update/delete` con `candidates:manage`.
- `candidate_tags`: `select` para staff con acceso al candidato; `insert/delete` con
  `candidates:manage`.
- `add_candidate_to_vacancy`: `grant execute` a `authenticated`; autoriza
  internamente.

## UI

**Pool (`candidatos/buscar`):**
- Chips de etiquetas por fila; filtro por etiqueta (combinable con los filtros
  actuales).
- Distintivo de consentimiento de cartera.
- Acción "Añadir a vacante" por fila → diálogo para elegir una vacante abierta →
  llama al RPC; si ya postuló, muestra el aviso.

**Ficha del candidato (`candidatos/[id]`):**
- Sección de etiquetas: asignar/quitar, con opción de crear una etiqueta nueva en
  línea.
- Botón "Añadir a vacante" (mismo diálogo).

## Flujo real en la app (end to end)

1. RRHH abre una vacante nueva ("Analista contable").
2. En lugar de publicar y esperar, entra a **Pool de talento** (`candidatos/buscar`).
3. Filtra por habilidad "contabilidad" + etiqueta "finalista". Ve candidatos del
   histórico con su estado previo (p. ej. "No seleccionado" en otra vacante) y el
   distintivo de consentimiento.
4. Encuentra a la persona que quedó 2da. Abre su ficha, revisa su CV y su evaluación
   anterior.
5. Pulsa **"Añadir a vacante"** y elige "Analista contable". Se crea su postulación en
   estado "Nuevo" con su CV vigente (`intake_method = cartera`). Si ya estuviera en esa
   vacante, se le avisa en vez de duplicar.
6. La persona aparece en el tablero de la vacante como una postulación nueva, lista
   para evaluar y entrevistar como cualquier otra. Queda todo auditado.
7. En paralelo, RRHH va **etiquetando** candidatos desde sus fichas ("recontratar",
   "Python senior") para armar sus grupos reutilizables.
8. Si alguien **revocó** el consentimiento de cartera, se ve el distintivo; el equipo
   decide (no se bloquea automáticamente).

## Ampliación (2026-11-17): sugeridos por vacante + acciones en lote

Tras validar el flujo con el usuario, el CRM gana un flujo centrado en la vacante
para evitar el reuso "uno por uno":

- **Sugeridos por vacante:** en la página de una vacante, una sección lista
  candidatos del histórico que **encajan** con ella. El encaje es **por
  habilidades/requisitos** (no por el motor de afinidad, que se reserva para una
  fase posterior): se derivan términos de los requisitos de la vacante y se cuentan
  coincidencias en los CV y las habilidades del candidato. Solo aparecen candidatos
  **disponibles** (sin postulación en proceso) y que **no** estén ya en esa vacante.
- **Acciones en lote** sobre una selección múltiple:
  - **Invitar por correo** (contacto previo): envía una invitación con plantilla a
    los candidatos seleccionados **antes** de reactivarlos. Respeta el
    consentimiento de cartera (a quien lo **revocó**, no se le escribe) y omite a
    quien no tiene correo. Es envío real (Resend); lleva confirmación.
  - **Añadir al proceso:** reactiva en lote (varios `add_candidate_to_vacancy` de
    una), informando éxitos y los que no se pudieron (p. ej. "ya en proceso").
- **Plantilla nueva** de correo: "invitación a nueva vacante".

Decisiones: encaje por habilidades (no motor) en v1; invitar y añadir van juntos;
el contacto directo desde el pool y el matching con motor quedan para después.

## Qué queda al builder

- Normalización/único de `name` en `talent_tags` (sin acentos/mayúsculas) siguiendo el
  patrón de `talent-pool/text.ts`.
- Forma exacta de la consulta de estado de consentimiento sobre `consent_records`.
- Si se incluye `color` en etiquetas en v1 o se deja para después.
- Textos y disposición concretos de la UI (chips, diálogo de vacante), siguiendo los
  componentes existentes.
- Pruebas: RLS de las tablas nuevas, no-duplicado del RPC, filtro por etiqueta, y el
  camino de reactivación.
