-- =============================================================================
-- Evaluación colaborativa (scorecards)
--
-- Varias personas del equipo de RRHH puntúan a un candidato con una rúbrica
-- común (competencias con escala 1–5) y una recomendación (avanza/duda/no
-- avanza). Cada evaluador tiene UNA tarjeta por postulación y solo edita la
-- suya; quien puede acceder a la postulación ve todas (para el consolidado).
-- Es un insumo para la decisión humana: no cambia el estado del proceso ni la
-- puntuación del motor. El momento natural es después de la entrevista, pero no
-- se bloquea por estado (la plataforma asiste, no obliga).
--
-- Las competencias viven en el código (rúbrica global), no en una tabla; aquí
-- solo se guardan los puntajes como jsonb. El servidor (Zod) valida que las
-- competencias y los puntajes 1–5 sean correctos antes de escribir.
-- =============================================================================

create type public.scorecard_recommendation as enum ('avanza', 'duda', 'no_avanza');

create table public.application_scorecards (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  evaluator_id uuid not null references public.profiles (id) on delete cascade,
  recommendation public.scorecard_recommendation not null,
  comment text check (comment is null or char_length(btrim(comment)) between 1 and 2000),
  scores jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_scorecards_unique unique (application_id, evaluator_id)
);

create index application_scorecards_application_idx on public.application_scorecards (application_id);

create trigger application_scorecards_set_updated_at before update on public.application_scorecards
  for each row execute function private.set_updated_at();
create trigger application_scorecards_audit after insert or update or delete on public.application_scorecards
  for each row execute function private.audit_row_change();

alter table public.application_scorecards enable row level security;

-- Ver: el personal que puede acceder a la postulación ve todas sus tarjetas.
create policy application_scorecards_select on public.application_scorecards
  for select to authenticated
  using (private.is_staff() and private.can_access_application(application_id));

-- Crear/editar/borrar: solo la tarjeta propia (evaluator_id = usuario actual).
create policy application_scorecards_insert on public.application_scorecards
  for insert to authenticated
  with check (
    private.is_staff()
    and private.can_access_application(application_id)
    and evaluator_id = (select auth.uid())
  );
create policy application_scorecards_update on public.application_scorecards
  for update to authenticated
  using (private.is_staff() and evaluator_id = (select auth.uid()))
  with check (private.is_staff() and evaluator_id = (select auth.uid()));
create policy application_scorecards_delete on public.application_scorecards
  for delete to authenticated
  using (private.is_staff() and evaluator_id = (select auth.uid()));

revoke all on table public.application_scorecards from anon, authenticated;
grant select on table public.application_scorecards to authenticated;
grant insert (application_id, evaluator_id, recommendation, comment, scores) on table public.application_scorecards to authenticated;
grant update (recommendation, comment, scores) on table public.application_scorecards to authenticated;
grant delete on table public.application_scorecards to authenticated;
