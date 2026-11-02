-- =============================================================================
-- Verificación de requisitos por RRHH
--
-- Después del CV, RRHH comprueba requisitos en una entrevista, con documentos,
-- por referencias o con una prueba técnica. Esa comprobación se guarda aparte
-- (una vigente por postulación y requisito; el historial lo guarda la
-- auditoría) y se aplica a la evaluación siguiente SIN perder lo que dijo el
-- CV: candidate_evaluation_items conserva la valoración original
-- (cv_assessment) junto con una copia de la verificación.
--
-- * requirement_verifications: solo lectura directa; se escribe con
--   verify_requirements y remove_requirement_verification.
-- * record_evaluation_core: exige que las valoraciones respeten las
--   verificaciones y copia los datos desde la tabla, no desde el cliente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
create type public.verification_source as enum (
  'entrevista',
  'documento',
  'referencia',
  'prueba_tecnica',
  'otro'
);

-- El valor nuevo no se usa en esta migración (solo dentro de cuerpos de
-- funciones, que se resuelven al ejecutarse), así que puede agregarse aquí.
alter type public.application_event_type add value if not exists 'requisito_verificado';

-- -----------------------------------------------------------------------------
-- 2. Tabla
-- -----------------------------------------------------------------------------
create table public.requirement_verifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  requirement_id uuid not null references public.vacancy_requirements (id) on delete cascade,
  result public.requirement_assessment not null
    check (result in ('acreditado', 'no_cumplido')),
  source public.verification_source not null,
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz not null default now(),
  unique (application_id, requirement_id)
);

create index requirement_verifications_requirement_idx
  on public.requirement_verifications (requirement_id);

create trigger requirement_verifications_audit
  after insert or update or delete on public.requirement_verifications
  for each row execute function private.audit_row_change();

alter table public.requirement_verifications enable row level security;

create policy requirement_verifications_select on public.requirement_verifications
  for select to authenticated
  using (private.can_access_application(application_id));

revoke all on table public.requirement_verifications from anon, authenticated;
grant select on table public.requirement_verifications to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Copia de la verificación en los ítems de la evaluación
-- -----------------------------------------------------------------------------
alter table public.candidate_evaluation_items
  add column cv_assessment public.requirement_assessment,
  add column verification_source public.verification_source,
  add column verification_note text,
  add column verified_by uuid references public.profiles (id) on delete set null,
  add column verified_at timestamptz;

-- -----------------------------------------------------------------------------
-- 4. verify_requirements
-- p_items: [{requirement_id, result, source, note}], de 1 a 30 elementos.
-- -----------------------------------------------------------------------------
create function public.verify_requirements(p_application_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy_id uuid;
  v_item jsonb;
  v_requirement_id uuid;
  v_ids uuid[] := '{}';
  v_note text;
  v_count integer;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select vacancy_id into v_vacancy_id from public.applications where id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Indique de 1 a 30 verificaciones' using errcode = 'RH422';
  end if;

  -- Validación completa antes de escribir.
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Formato de verificación inválido' using errcode = 'RH422';
    end if;
    v_requirement_id := private.try_uuid(v_item ->> 'requirement_id');
    if v_requirement_id is null or not exists (
      select 1 from public.vacancy_requirements r
      where r.id = v_requirement_id and r.vacancy_id = v_vacancy_id
    ) then
      raise exception 'El requisito no pertenece a la vacante de la postulación' using errcode = 'RH422';
    end if;
    if v_requirement_id = any (v_ids) then
      raise exception 'Un requisito no puede verificarse dos veces en la misma solicitud' using errcode = 'RH422';
    end if;
    v_ids := v_ids || v_requirement_id;
    if (v_item ->> 'result') is null or (v_item ->> 'result') not in ('acreditado', 'no_cumplido') then
      raise exception 'El resultado de la verificación debe ser «cumple» o «no cumple»' using errcode = 'RH422';
    end if;
    if (v_item ->> 'source') is null
       or (v_item ->> 'source') not in (select unnest(enum_range(null::public.verification_source))::text) then
      raise exception 'La fuente de la verificación no es válida' using errcode = 'RH422';
    end if;
    v_note := btrim(coalesce(v_item ->> 'note', ''));
    if char_length(v_note) not between 3 and 1000 then
      raise exception 'La nota de la verificación debe tener entre 3 y 1000 caracteres' using errcode = 'RH422';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.requirement_verifications as v (
      application_id, requirement_id, result, source, note, verified_by, verified_at
    )
    values (
      p_application_id,
      (v_item ->> 'requirement_id')::uuid,
      (v_item ->> 'result')::public.requirement_assessment,
      (v_item ->> 'source')::public.verification_source,
      btrim(v_item ->> 'note'),
      (select auth.uid()),
      now()
    )
    on conflict (application_id, requirement_id) do update
      set result = excluded.result,
          source = excluded.source,
          note = excluded.note,
          verified_by = excluded.verified_by,
          verified_at = excluded.verified_at;
  end loop;

  v_count := jsonb_array_length(p_items);
  insert into public.application_events (application_id, event_type, note, actor_id)
  values (
    p_application_id,
    'requisito_verificado',
    case when v_count = 1 then '1 requisito verificado' else v_count || ' requisitos verificados' end,
    (select auth.uid())
  );

  return v_count;
end
$$;

revoke all on function public.verify_requirements(uuid, jsonb) from public, anon;
grant execute on function public.verify_requirements(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. remove_requirement_verification
-- -----------------------------------------------------------------------------
create function public.remove_requirement_verification(
  p_application_id uuid,
  p_requirement_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_description text;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if char_length(v_note) not between 3 and 1000 then
    raise exception 'La nota debe tener entre 3 y 1000 caracteres' using errcode = 'RH422';
  end if;

  delete from public.requirement_verifications
  where application_id = p_application_id and requirement_id = p_requirement_id;
  if not found then
    raise exception 'La verificación no existe' using errcode = 'RH404';
  end if;

  select left(description, 200) into v_description
  from public.vacancy_requirements where id = p_requirement_id;

  insert into public.application_events (application_id, event_type, note, actor_id)
  values (
    p_application_id,
    'requisito_verificado',
    left('Verificación quitada: ' || coalesce(v_description, 'requisito') || '. ' || v_note, 4000),
    (select auth.uid())
  );
end
$$;

revoke all on function public.remove_requirement_verification(uuid, uuid, text) from public, anon;
grant execute on function public.remove_requirement_verification(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. record_evaluation_core: respeta y copia las verificaciones
-- Misma firma y mismos privilegios que en 20261028000300_talent_apply.sql.
-- -----------------------------------------------------------------------------
create or replace function private.record_evaluation_core(
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
  p_items jsonb,
  p_actor uuid
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

  -- Las verificaciones de RRHH prevalecen: la valoración de un requisito
  -- verificado debe coincidir con el resultado registrado, y debe indicar qué
  -- dijo el CV (cv_assessment) para conservarlo.
  if exists (
    select 1
    from jsonb_array_elements(p_items) i
    join public.requirement_verifications v
      on v.application_id = v_app.id
     and v.requirement_id = private.try_uuid(i ->> 'requirement_id')
    where i ->> 'assessment' is distinct from v.result::text
  ) then
    raise exception 'La evaluación no respeta las verificaciones registradas' using errcode = 'RH422';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) i
    join public.requirement_verifications v
      on v.application_id = v_app.id
     and v.requirement_id = private.try_uuid(i ->> 'requirement_id')
    where (i ->> 'cv_assessment') is null
       or (i ->> 'cv_assessment') not in (select unnest(enum_range(null::public.requirement_assessment))::text)
  ) then
    raise exception 'Falta la valoración original del CV de un requisito verificado' using errcode = 'RH422';
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
    p_summary, coalesce(p_limitations, '{}'), p_input_sha256, p_actor
  )
  returning id into v_eval_id;

  -- Los campos de verificación se copian de la tabla, nunca del cliente.
  insert into public.candidate_evaluation_items (
    evaluation_id, requirement_id, category, priority, description, weight,
    is_essential, assessment, evidence, rationale, position,
    cv_assessment, verification_source, verification_note, verified_by, verified_at
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
    r.position,
    case when v.id is not null then (i ->> 'cv_assessment')::public.requirement_assessment end,
    v.source,
    v.note,
    v.verified_by,
    v.verified_at
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r on r.id = private.try_uuid(i ->> 'requirement_id')
  left join public.requirement_verifications v
    on v.application_id = v_app.id and v.requirement_id = r.id;

  update public.applications
  set latest_evaluation_id = v_eval_id
  where id = v_app.id;

  insert into public.application_events (application_id, event_type, actor_id)
  values (v_app.id, 'evaluacion_generada', p_actor);

  return v_eval_id;
end
$$;
