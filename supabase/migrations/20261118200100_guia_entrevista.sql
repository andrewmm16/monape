-- =============================================================================
-- Guía de entrevista: cada requisito evaluado guarda la duda concreta del motor
-- y la pregunta de entrevista que redactó la IA, para armar el guion de lo que
-- falta confirmar (src/modules/evaluation/interview-guide.ts).
--
-- * candidate_evaluation_items.signal: marca de duda del motor (EngineSignal:
--   cargo_relacionado, nivel_inferior, fechas_no_cuadran…). Es un código, sin
--   datos personales. Antes solo vivía en memoria.
-- * candidate_evaluation_items.interview_question: pregunta redactada por la IA
--   para ese requisito (ia-prompt-v5). Puede citar el CV: la anonimización la borra.
-- * record_evaluation_core: igual que en 20261118000200_motor_aprende.sql, más
--   las dos columnas (valores con otro formato se ignoran, no fallan).
-- * anonymize_candidate: igual que en 20261118100400_candidate_retention.sql,
--   más el borrado de interview_question.
-- =============================================================================

alter table public.candidate_evaluation_items
  add column signal text check (signal ~ '^[a-z_]{1,40}$'),
  add column interview_question text check (char_length(interview_question) between 1 and 500);

-- -----------------------------------------------------------------------------
-- record_evaluation_core
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
    cv_assessment, cv_rationale, verification_source, verification_note, verified_by, verified_at,
    resolved_by, engine_assessment, learned_equivalence_id,
    signal, interview_question
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
    v.verified_at,
    -- De dónde sale la valoración (20261118000200): motor (nulo), IA o regla aprendida.
    case when i ->> 'resolved_by' in ('ia', 'regla_aprendida') then i ->> 'resolved_by' end,
    case
      when i ->> 'resolved_by' in ('ia', 'regla_aprendida')
       and (i ->> 'engine_assessment') in (select unnest(enum_range(null::public.requirement_assessment))::text)
      then (i ->> 'engine_assessment')::public.requirement_assessment
    end,
    (select le.id from public.learned_equivalences le where le.id = private.try_uuid(i ->> 'learned_equivalence_id')),
    -- Guía de entrevista (20261118200100): la duda del motor y la pregunta de la IA.
    case when (i ->> 'signal') ~ '^[a-z_]{1,40}$' then i ->> 'signal' end,
    nullif(left(btrim(coalesce(i ->> 'interview_question', '')), 500), '')
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
-- anonymize_candidate
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_candidate(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.candidates%rowtype;
  v_resumes integer;
begin
  if not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_candidate from public.candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'Candidato no encontrado' using errcode = 'RH404';
  end if;
  if v_candidate.anonymized_at is not null then
    raise exception 'El candidato ya está anonimizado' using errcode = 'RH409';
  end if;
  if exists (
    select 1 from public.applications a
    where a.candidate_id = p_candidate_id and private.is_application_in_process(a.status)
  ) then
    raise exception 'Tiene una postulación en curso: ciérrela antes de anonimizar' using errcode = 'RH409';
  end if;

  -- CV (y su texto extraído, en cascada), perfil, etiquetas y prospectos de Caleta.
  delete from public.resumes where candidate_id = p_candidate_id;
  get diagnostics v_resumes = row_count;
  delete from public.candidate_profile_items where candidate_id = p_candidate_id;
  delete from public.candidate_tags where candidate_id = p_candidate_id;
  delete from public.caleta_prospects where candidate_id = p_candidate_id;

  -- Textos libres ligados a sus postulaciones.
  update public.application_events e
  set note = case when e.event_type = 'observacion' then '[anonimizado]' end,
      reason = null
  from public.applications a
  where a.id = e.application_id and a.candidate_id = p_candidate_id
    and (e.note is not null or e.reason is not null);

  update public.candidate_evaluations ev
  set summary = 'Evaluación anonimizada.', limitations = '{}', review_notes = null
  from public.applications a
  where a.id = ev.application_id and a.candidate_id = p_candidate_id;

  update public.candidate_evaluation_items it
  set evidence = '[]'::jsonb, rationale = '', cv_rationale = null, verification_note = null, interview_question = null
  from public.candidate_evaluations ev
  join public.applications a on a.id = ev.application_id
  where ev.id = it.evaluation_id and a.candidate_id = p_candidate_id;

  update public.application_killer_answers k
  set answer_text = null
  from public.applications a
  where a.id = k.application_id and a.candidate_id = p_candidate_id and k.answer_text is not null;

  update public.requirement_verifications v
  set note = 'Dato anonimizado'
  from public.applications a
  where a.id = v.application_id and a.candidate_id = p_candidate_id;

  update public.interviews i
  set result_notes = case when i.result_notes is null then null else '[anonimizado]' end,
      cancel_reason = case when i.cancel_reason is null then null else '[anonimizado]' end,
      instructions = null
  from public.applications a
  where a.id = i.application_id and a.candidate_id = p_candidate_id;

  update public.interview_scorecards s
  set comment = null
  from public.interviews i
  join public.applications a on a.id = i.application_id
  where s.interview_id = i.id and a.candidate_id = p_candidate_id and s.comment is not null;

  update public.applications
  set possible_duplicate_reasons = '{}'
  where candidate_id = p_candidate_id and cardinality(possible_duplicate_reasons) > 0;

  update public.intake_batch_items
  set full_name = null, email = null, phone = null, raw_text = null, suggested_fields = '{}'::jsonb
  where candidate_id = p_candidate_id;

  update public.candidates
  set full_name = 'Persona anonimizada ' || left(p_candidate_id::text, 8),
      email = null,
      phone = null,
      location = null,
      linkedin_url = null,
      source_detail = null,
      field_origins = '{}'::jsonb,
      anonymized_at = now()
  where id = p_candidate_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'candidato_anonimizado',
    'candidates',
    p_candidate_id::text,
    jsonb_build_object('resumes_deleted', v_resumes)
  );
end
$$;
