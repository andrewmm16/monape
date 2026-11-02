-- =============================================================================
-- Endurecimiento de entrevistas y verificaciones
--
-- 1. candidate_evaluation_items.cv_rationale: el motivo original del CV (o del
--    motor) de un requisito verificado, para poder reconstruir la evaluación
--    sin la verificación al quitarla. record_evaluation_core lo guarda desde el
--    ítem solo cuando hay verificación.
-- 2. Cuando una postulación pasa a un estado cerrado se cancelan, en la misma
--    transacción, sus entrevistas programadas.
-- 3. reschedule_interview rechaza postulaciones cerradas y vacantes archivadas.
-- =============================================================================

alter table public.candidate_evaluation_items
  add column cv_rationale text check (char_length(cv_rationale) <= 2000);

-- Misma firma y mismos privilegios que en 20261028001000_requirement_verifications.sql.
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
    cv_assessment, cv_rationale, verification_source, verification_note, verified_by, verified_at
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
    case when v.id is not null then nullif(left(i ->> 'cv_rationale', 2000), '') end,
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

-- -----------------------------------------------------------------------------
-- 2. Estado cerrado => entrevistas programadas canceladas
-- -----------------------------------------------------------------------------
create or replace function private.apply_application_status(
  p_application_id uuid,
  p_old public.application_status,
  p_new public.application_status,
  p_reason text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview record;
  v_reason text;
begin
  update public.applications
  set status = p_new,
      status_changed_at = now()
  where id = p_application_id;

  insert into public.application_events (
    application_id, event_type, from_status, to_status, reason, note, actor_id
  )
  values (
    p_application_id,
    'cambio_estado',
    p_old,
    p_new,
    left(nullif(btrim(p_reason), ''), 500),
    nullif(btrim(p_note), ''),
    (select auth.uid())
  );

  if p_new in ('seleccionado', 'no_seleccionado', 'retirado') then
    v_reason := 'Cancelada automáticamente: la postulación pasó a «'
      || case p_new
           when 'seleccionado' then 'Seleccionado'
           when 'no_seleccionado' then 'No seleccionado'
           else 'Retirado'
         end || '»';
    for v_interview in
      update public.interviews
      set status = 'cancelada',
          cancel_reason = v_reason
      where application_id = p_application_id and status = 'programada'
      returning scheduled_at
    loop
      insert into public.application_events (application_id, event_type, reason, note, actor_id)
      values (
        p_application_id,
        'entrevista_cancelada',
        v_reason,
        'Entrevista del ' || to_char(v_interview.scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI'),
        (select auth.uid())
      );
    end loop;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. reschedule_interview: no sobre postulaciones cerradas ni vacantes archivadas
-- Misma firma y mismos privilegios que en 20261028001100_interviews.sql.
-- -----------------------------------------------------------------------------
create or replace function public.reschedule_interview(
  p_interview_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 45,
  p_modality public.interview_modality default 'presencial',
  p_location text default null,
  p_interviewers text default null,
  p_instructions text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
  v_status public.application_status;
  v_vacancy_status public.vacancy_status;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_interview from public.interviews where id = p_interview_id for update;
  if not found then
    raise exception 'La entrevista no existe' using errcode = 'RH404';
  end if;
  if not private.can_access_application(v_interview.application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_interview.status <> 'programada' then
    raise exception 'Solo se puede reprogramar una entrevista programada' using errcode = 'RH409';
  end if;

  select a.status, v.status into v_status, v_vacancy_status
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  where a.id = v_interview.application_id;
  if v_vacancy_status = 'archivada' then
    raise exception 'La vacante está archivada' using errcode = 'RH409';
  end if;
  if v_status in ('seleccionado', 'no_seleccionado', 'retirado') then
    raise exception 'La postulación ya está cerrada: no se puede reprogramar la entrevista' using errcode = 'RH409';
  end if;

  if p_modality is null then
    raise exception 'Indique la modalidad de la entrevista' using errcode = 'RH422';
  end if;
  perform private.check_interview_fields(p_scheduled_at, p_duration_minutes, p_location, p_interviewers, p_instructions);

  update public.interviews
  set scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      modality = p_modality,
      location = nullif(btrim(p_location), ''),
      interviewers = nullif(btrim(p_interviewers), ''),
      instructions = nullif(btrim(p_instructions), '')
  where id = p_interview_id;

  insert into public.application_events (application_id, event_type, note, actor_id)
  values (
    v_interview.application_id,
    'entrevista_reprogramada',
    'Del ' || to_char(v_interview.scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI')
      || ' al ' || to_char(p_scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI')
      || ' (' || p_duration_minutes || ' min, ' || p_modality::text || ')',
    (select auth.uid())
  );
end
$$;

revoke all on function public.reschedule_interview(uuid, timestamptz, integer, public.interview_modality, text, text, text) from public, anon;
grant execute on function public.reschedule_interview(uuid, timestamptz, integer, public.interview_modality, text, text, text) to authenticated;
