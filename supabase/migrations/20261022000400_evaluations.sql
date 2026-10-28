-- =============================================================================
-- 0004 · Evaluaciones de compatibilidad, vista de candidatos por vacante y
-- resumen del panel
-- =============================================================================

create type public.requirement_assessment as enum (
  'acreditado',             -- hay evidencia en el CV
  'no_cumplido',            -- la información disponible indica que no se cumple
  'sin_evidencia',          -- el CV no aporta información (no implica incapacidad)
  'pendiente_verificacion'  -- requiere verificación humana (entrevista, documentos)
);
create type public.compatibility_level as enum ('alta', 'parcial', 'baja', 'pendiente');
create type public.evaluation_method as enum ('reglas', 'ia');
create type public.evaluation_review_status as enum ('pendiente_revision', 'revisada');
create type public.evaluation_review_outcome as enum (
  'conforme', 'con_observaciones', 'requiere_reevaluacion'
);

create table public.candidate_evaluations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  resume_id uuid references public.resumes (id) on delete set null,
  criteria_version integer not null check (criteria_version > 0),
  method public.evaluation_method not null,
  method_version text not null check (char_length(method_version) <= 64),
  scoring_version text not null check (char_length(scoring_version) <= 32),
  model text check (char_length(model) <= 100),
  -- Porcentajes ponderados (ver docs/metodologia-evaluacion.md)
  score numeric(5, 2) not null,
  score_potential numeric(5, 2) not null,
  evidence_coverage numeric(5, 2) not null,
  level public.compatibility_level not null,
  summary text not null check (char_length(summary) <= 4000),
  limitations text[] not null default '{}',
  input_sha256 text check (input_sha256 ~ '^[0-9a-f]{64}$'),
  review_status public.evaluation_review_status not null default 'pendiente_revision',
  review_outcome public.evaluation_review_outcome,
  review_notes text check (char_length(review_notes) <= 4000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint candidate_evaluations_score_range
    check (score >= 0 and score <= score_potential and score_potential <= 100),
  constraint candidate_evaluations_coverage_range
    check (evidence_coverage >= 0 and evidence_coverage <= 100),
  constraint candidate_evaluations_review_consistency
    check ((review_status = 'revisada') = (reviewed_at is not null and review_outcome is not null))
);

create index candidate_evaluations_application_idx
  on public.candidate_evaluations (application_id, created_at desc);

-- Cada ítem guarda una copia del requisito evaluado para que el historial siga
-- siendo interpretable aunque los criterios cambien después.
create table public.candidate_evaluation_items (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.candidate_evaluations (id) on delete cascade,
  requirement_id uuid references public.vacancy_requirements (id) on delete set null,
  category public.requirement_category not null,
  priority public.requirement_priority not null,
  description text not null,
  weight smallint not null check (weight between 1 and 10),
  is_essential boolean not null,
  assessment public.requirement_assessment not null,
  -- [{"quote": "...", "start": 120, "end": 180}]
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  rationale text not null check (char_length(rationale) <= 2000),
  position integer not null default 0
);

create index candidate_evaluation_items_evaluation_idx
  on public.candidate_evaluation_items (evaluation_id, position);

alter table public.applications
  add constraint applications_latest_evaluation_fk
  foreign key (latest_evaluation_id) references public.candidate_evaluations (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Registro de una evaluación. Verifica que:
--   * quien la registra es RRHH o administrador;
--   * los criterios de la vacante están aprobados y la versión coincide;
--   * se evalúan exactamente los requisitos vigentes (mismos criterios para
--     todos los candidatos);
--   * los porcentajes y el nivel son coherentes con los pesos guardados en la
--     base (se recalculan aquí con la misma metodología que scoring.ts).
-- La evaluación NUNCA modifica el estado de la postulación.
-- -----------------------------------------------------------------------------
create function public.record_evaluation(
  p_application_id uuid,
  p_resume_id uuid,
  p_criteria_version integer,
  p_method public.evaluation_method,
  p_method_version text,
  p_scoring_version text,
  p_model text,
  p_score numeric,
  p_score_potential numeric,
  p_evidence_coverage numeric,
  p_level public.compatibility_level,
  p_summary text,
  p_limitations text[],
  p_input_sha256 text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_vacancy public.vacancies%rowtype;
  v_eval_id uuid;
  v_expected integer;
  v_matched integer;
  v_total numeric;
  v_score numeric;
  v_potential numeric;
  v_coverage numeric;
  v_unknown numeric;
  v_mandatory_not_met boolean;
  v_level public.compatibility_level;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  select * into v_vacancy from public.vacancies where id = v_app.vacancy_id for share;
  if v_vacancy.criteria_approved_at is null then
    raise exception 'Los criterios de la vacante no están aprobados' using errcode = 'RH409';
  end if;
  if v_vacancy.criteria_version <> p_criteria_version then
    raise exception 'La versión de criterios no coincide con la vigente' using errcode = 'RH409';
  end if;

  if p_resume_id is not null and not exists (
    select 1 from public.resumes r
    where r.id = p_resume_id and r.candidate_id = v_app.candidate_id
  ) then
    raise exception 'El CV no pertenece al candidato' using errcode = 'RH422';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Formato de ítems inválido' using errcode = 'RH422';
  end if;

  select count(*) into v_expected
  from public.vacancy_requirements
  where vacancy_id = v_vacancy.id;

  select count(distinct r.id) into v_matched
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r
    on r.id = private.try_uuid(i ->> 'requirement_id')
   and r.vacancy_id = v_vacancy.id;

  if v_expected = 0 or v_matched <> v_expected or jsonb_array_length(p_items) <> v_expected then
    raise exception 'La evaluación debe cubrir exactamente los requisitos vigentes' using errcode = 'RH422';
  end if;

  -- Recalcula los porcentajes con los pesos almacenados.
  select
    sum(r.weight),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' = 'acreditado'),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' <> 'no_cumplido'),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' in ('acreditado', 'no_cumplido')),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' in ('sin_evidencia', 'pendiente_verificacion')),
    coalesce(bool_or(r.priority = 'obligatorio' and i ->> 'assessment' = 'no_cumplido'), false)
  into v_total, v_score, v_potential, v_coverage, v_unknown, v_mandatory_not_met
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r on r.id = private.try_uuid(i ->> 'requirement_id');

  v_score := round(coalesce(v_score, 0) / v_total, 2);
  v_potential := round(coalesce(v_potential, 0) / v_total, 2);
  v_coverage := round(coalesce(v_coverage, 0) / v_total, 2);
  v_unknown := round(coalesce(v_unknown, 0) / v_total, 2);

  if abs(v_score - p_score) > 0.01
     or abs(v_potential - p_score_potential) > 0.01
     or abs(v_coverage - p_evidence_coverage) > 0.01 then
    raise exception 'Los porcentajes no coinciden con la metodología de puntuación' using errcode = 'RH422';
  end if;

  -- Nivel orientativo con las mismas reglas que determineLevel (scoring.ts).
  v_level := case
    when v_unknown > 50 then 'pendiente'
    when v_score >= 70 and not v_mandatory_not_met then 'alta'
    when v_score >= 40 then 'parcial'
    else 'baja'
  end;
  if v_level <> p_level then
    raise exception 'El nivel no coincide con la metodología de puntuación' using errcode = 'RH422';
  end if;

  insert into public.candidate_evaluations (
    application_id, resume_id, criteria_version, method, method_version,
    scoring_version, model, score, score_potential, evidence_coverage, level,
    summary, limitations, input_sha256, created_by
  )
  values (
    v_app.id, p_resume_id, p_criteria_version, p_method, p_method_version,
    p_scoring_version, p_model, v_score, v_potential, v_coverage, v_level,
    p_summary, coalesce(p_limitations, '{}'), p_input_sha256, (select auth.uid())
  )
  returning id into v_eval_id;

  insert into public.candidate_evaluation_items (
    evaluation_id, requirement_id, category, priority, description, weight,
    is_essential, assessment, evidence, rationale, position
  )
  select
    v_eval_id,
    r.id,
    r.category,
    r.priority,
    r.description,
    r.weight,
    r.is_essential,
    (i ->> 'assessment')::public.requirement_assessment,
    coalesce(i -> 'evidence', '[]'::jsonb),
    left(coalesce(i ->> 'rationale', ''), 2000),
    r.position
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r on r.id = private.try_uuid(i ->> 'requirement_id');

  update public.applications
  set latest_evaluation_id = v_eval_id
  where id = v_app.id;

  insert into public.application_events (application_id, event_type, actor_id)
  values (v_app.id, 'evaluacion_generada', (select auth.uid()));

  return v_eval_id;
end
$$;

revoke all on function public.record_evaluation(
  uuid, uuid, integer, public.evaluation_method, text, text, text, numeric, numeric,
  numeric, public.compatibility_level, text, text[], text, jsonb
) from public, anon;
grant execute on function public.record_evaluation(
  uuid, uuid, integer, public.evaluation_method, text, text, text, numeric, numeric,
  numeric, public.compatibility_level, text, text[], text, jsonb
) to authenticated;

-- Revisión humana de la evaluación.
create function public.review_evaluation(
  p_evaluation_id uuid,
  p_outcome public.evaluation_review_outcome,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_outcome in ('con_observaciones', 'requiere_reevaluacion')
     and char_length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Debe registrar las observaciones de la revisión' using errcode = 'RH422';
  end if;

  -- Cada evaluación se revisa una sola vez; para corregir el criterio se
  -- genera una nueva evaluación (el historial conserva ambas).
  update public.candidate_evaluations
  set review_status = 'revisada',
      review_outcome = p_outcome,
      review_notes = nullif(btrim(p_notes), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_evaluation_id
    and review_status = 'pendiente_revision'
  returning application_id into v_application_id;

  if v_application_id is null then
    if exists (select 1 from public.candidate_evaluations where id = p_evaluation_id) then
      raise exception 'La evaluación ya fue revisada' using errcode = 'RH409';
    end if;
    raise exception 'Evaluación no encontrada' using errcode = 'RH404';
  end if;

  insert into public.application_events (application_id, event_type, reason, actor_id)
  values (v_application_id, 'evaluacion_revisada', p_outcome::text, (select auth.uid()));
end
$$;

revoke all on function public.review_evaluation(uuid, public.evaluation_review_outcome, text) from public, anon;
grant execute on function public.review_evaluation(uuid, public.evaluation_review_outcome, text) to authenticated;

create trigger candidate_evaluations_audit
  after insert or update or delete on public.candidate_evaluations
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS: lectura según acceso a la postulación. Escritura solo mediante las
-- funciones anteriores (no se conceden INSERT/UPDATE directos).
-- -----------------------------------------------------------------------------
alter table public.candidate_evaluations enable row level security;
alter table public.candidate_evaluation_items enable row level security;

create policy candidate_evaluations_select on public.candidate_evaluations
  for select to authenticated
  using (private.can_access_application(application_id));

create policy candidate_evaluation_items_select on public.candidate_evaluation_items
  for select to authenticated
  using (exists (
    select 1 from public.candidate_evaluations e
    where e.id = evaluation_id
      and private.can_access_application(e.application_id)
  ));

revoke all on table public.candidate_evaluations from anon, authenticated;
revoke all on table public.candidate_evaluation_items from anon, authenticated;
grant select on table public.candidate_evaluations to authenticated;
grant select on table public.candidate_evaluation_items to authenticated;

-- -----------------------------------------------------------------------------
-- Vista de candidatos por vacante (respeta RLS del usuario que consulta)
-- -----------------------------------------------------------------------------
create view public.application_overview
with (security_invoker = true)
as
select
  a.id,
  a.vacancy_id,
  a.candidate_id,
  a.status,
  a.applied_at,
  a.status_changed_at,
  a.assigned_evaluator_id,
  ev.full_name as assigned_evaluator_name,
  c.full_name as candidate_name,
  c.email as candidate_email,
  v.title as vacancy_title,
  v.criteria_version as vacancy_criteria_version,
  (v.criteria_approved_at is null) as criteria_pending_approval,
  e.id as evaluation_id,
  e.score,
  e.score_potential,
  e.evidence_coverage,
  e.level,
  e.method as evaluation_method,
  e.review_status,
  e.created_at as evaluated_at,
  e.criteria_version as evaluation_criteria_version,
  coalesce(e.criteria_version < v.criteria_version, false) as evaluation_outdated,
  coalesce(m.top_met, '{}') as top_met,
  coalesce(m.top_gaps, '{}') as top_gaps,
  coalesce(m.top_pending, '{}') as top_pending
from public.applications a
join public.candidates c on c.id = a.candidate_id
join public.vacancies v on v.id = a.vacancy_id
left join public.profiles ev on ev.id = a.assigned_evaluator_id
left join public.candidate_evaluations e on e.id = a.latest_evaluation_id
left join lateral (
  select
    (array_agg(i.description order by i.weight desc, i.position)
      filter (where i.assessment = 'acreditado'))[1:3] as top_met,
    (array_agg(i.description order by i.weight desc, i.position)
      filter (where i.assessment in ('no_cumplido', 'sin_evidencia')))[1:3] as top_gaps,
    (array_agg(i.description order by i.weight desc, i.position)
      filter (where i.assessment = 'pendiente_verificacion'))[1:3] as top_pending
  from public.candidate_evaluation_items i
  where i.evaluation_id = e.id
) m on true;

revoke all on public.application_overview from anon, authenticated;
grant select on public.application_overview to authenticated;

-- -----------------------------------------------------------------------------
-- Indicadores del panel (SECURITY INVOKER: cada usuario ve su ámbito)
-- -----------------------------------------------------------------------------
create function public.get_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'active_vacancies',
      (select count(*) from public.vacancies v where v.status = 'publicada'),
    'draft_vacancies',
      (select count(*) from public.vacancies v where v.status = 'borrador'),
    'vacancies_pending_criteria',
      (select count(*) from public.vacancies v
        where v.status in ('borrador', 'publicada') and v.criteria_approved_at is null),
    'applications_by_status',
      (select coalesce(jsonb_object_agg(s.status, s.total), '{}'::jsonb)
         from (select a.status, count(*) as total
                 from public.applications a
                 join public.vacancies v on v.id = a.vacancy_id
                where v.status <> 'archivada'
                group by a.status) s),
    'candidates_per_vacancy',
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc, x.title), '[]'::jsonb)
         from (select v.id, v.title, v.department,
                      count(a.id) as total,
                      count(a.id) filter (where a.latest_evaluation_id is null) as without_evaluation
                 from public.vacancies v
                 left join public.applications a on a.vacancy_id = v.id
                where v.status = 'publicada'
                group by v.id) x),
    'pending_evaluations',
      (select count(*)
         from public.applications a
         join public.vacancies v on v.id = a.vacancy_id
         left join public.candidate_evaluations e on e.id = a.latest_evaluation_id
        where v.status in ('borrador', 'publicada')
          and a.status not in ('seleccionado', 'no_seleccionado', 'retirado')
          and (e.id is null or e.criteria_version < v.criteria_version)),
    'pending_reviews',
      (select count(*)
         from public.applications a
         join public.candidate_evaluations e on e.id = a.latest_evaluation_id
        where e.review_status = 'pendiente_revision'
          and a.status not in ('seleccionado', 'no_seleccionado', 'retirado')),
    'recent_activity',
      (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
         from (select ev.id, ev.created_at, ev.event_type, ev.from_status, ev.to_status,
                      ev.application_id, c.full_name as candidate_name,
                      v.title as vacancy_title, p.full_name as actor_name
                 from public.application_events ev
                 join public.applications a on a.id = ev.application_id
                 join public.candidates c on c.id = a.candidate_id
                 join public.vacancies v on v.id = a.vacancy_id
                 left join public.profiles p on p.id = ev.actor_id
                order by ev.created_at desc
                limit 10) r)
  )
$$;

revoke all on function public.get_dashboard_summary() from public, anon;
grant execute on function public.get_dashboard_summary() to authenticated;
