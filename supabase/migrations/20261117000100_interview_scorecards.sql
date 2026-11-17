-- =============================================================================
-- Evaluación colaborativa por entrevista (scorecards)
--
-- La valoración del equipo cuelga de cada ENTREVISTA, no del candidato en
-- abstracto: un proceso pasa por varias entrevistas (varios entrevistadores) y
-- cada ronda puede ver cosas distintas o dejar algo por corroborar en la
-- siguiente. Cada evaluador deja UNA tarjeta por entrevista (rúbrica común,
-- competencias 1–5 + recomendación) y solo edita la suya; quien accede a la
-- postulación ve todas (para el consolidado por ronda y el resumen del
-- candidato).
--
-- Solo se puede evaluar una entrevista ya REALIZADA (con resultado registrado):
-- se valora lo observado en la entrevista, no lo que dice el CV (eso ya lo mide
-- el motor). Por el constraint interviews_result_matches_status, «realizada»
-- implica result in ('paso','no_paso'); «no asistió» tiene su propio estado y no
-- es evaluable. Es un insumo para la decisión humana: no cambia el estado del
-- proceso ni la puntuación del motor.
--
-- Reemplaza a public.application_scorecards (misma fase, sin datos productivos
-- que migrar). Reutiliza el enum public.scorecard_recommendation.
-- =============================================================================

drop table if exists public.application_scorecards;

-- -----------------------------------------------------------------------------
-- Helpers: acceso y «evaluable» para una entrevista. SECURITY DEFINER para
-- resolver el vínculo entrevista → postulación sin exponer interviews a
-- subconsultas con RLS dentro de las políticas.
-- -----------------------------------------------------------------------------
create function private.can_access_interview(p_interview_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_application(application_id)
  from public.interviews
  where id = p_interview_id;
$$;

revoke all on function private.can_access_interview(uuid) from public;
grant execute on function private.can_access_interview(uuid) to authenticated, service_role;

create function private.interview_is_evaluable(p_interview_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select status = 'realizada'
  from public.interviews
  where id = p_interview_id;
$$;

revoke all on function private.interview_is_evaluable(uuid) from public;
grant execute on function private.interview_is_evaluable(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tabla
-- -----------------------------------------------------------------------------
create table public.interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  evaluator_id uuid not null references public.profiles (id) on delete cascade,
  recommendation public.scorecard_recommendation not null,
  comment text check (comment is null or char_length(btrim(comment)) between 1 and 2000),
  scores jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_scorecards_unique unique (interview_id, evaluator_id)
);

create index interview_scorecards_interview_idx on public.interview_scorecards (interview_id);

create trigger interview_scorecards_set_updated_at before update on public.interview_scorecards
  for each row execute function private.set_updated_at();
create trigger interview_scorecards_audit after insert or update or delete on public.interview_scorecards
  for each row execute function private.audit_row_change();

alter table public.interview_scorecards enable row level security;

-- Ver: el personal con acceso a la postulación de la entrevista ve todas sus tarjetas.
create policy interview_scorecards_select on public.interview_scorecards
  for select to authenticated
  using (private.is_staff() and private.can_access_interview(interview_id));

-- Crear: solo la propia, en una entrevista realizada a la que se tiene acceso.
create policy interview_scorecards_insert on public.interview_scorecards
  for insert to authenticated
  with check (
    private.is_staff()
    and private.can_access_interview(interview_id)
    and private.interview_is_evaluable(interview_id)
    and evaluator_id = (select auth.uid())
  );

-- Editar: solo la propia (y mientras la entrevista siga siendo evaluable).
create policy interview_scorecards_update on public.interview_scorecards
  for update to authenticated
  using (private.is_staff() and evaluator_id = (select auth.uid()))
  with check (
    private.is_staff()
    and evaluator_id = (select auth.uid())
    and private.interview_is_evaluable(interview_id)
  );

-- Borrar: solo la propia.
create policy interview_scorecards_delete on public.interview_scorecards
  for delete to authenticated
  using (private.is_staff() and evaluator_id = (select auth.uid()));

revoke all on table public.interview_scorecards from anon, authenticated;
grant select on table public.interview_scorecards to authenticated;
grant insert (interview_id, evaluator_id, recommendation, comment, scores) on table public.interview_scorecards to authenticated;
grant update (recommendation, comment, scores) on table public.interview_scorecards to authenticated;
grant delete on table public.interview_scorecards to authenticated;
