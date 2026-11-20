-- =============================================================================
-- Preguntas para profundizar en la entrevista
-- (docs/superpowers/specs/2026-11-20-preguntas-profundizar-design.md)
--
-- Tercer tipo de tarea del worker de IA (después de las evaluaciones de CV y
-- antes del segundo juez): para quien va a entrevista, la IA escribe una
-- pregunta por cada requisito que el CV acredita («profundizar») y reescribe
-- las preguntas «por confirmar» que eran plantilla («confirmar»). No cambian la
-- puntuación. El worker solo transporta: la app arma el prompt y valida.
--
-- 1. interview_deep_dives: un trabajo por solicitud; como máximo uno abierto
--    por postulación. Guarda lo pedido (requested_items) y las preguntas.
--    Vigencia: el CV (resume_id) y la versión de criterios de la evaluación
--    con que se armó, no la evaluación misma (cambia con cada verificación).
-- 2. request_interview_deep_dive (personal): manual (botón) o automática (al
--    pasar a «Entrevista programada»; no se repite con el mismo CV y criterios).
-- 3. deep_dive_claim / deep_dive_start / deep_dive_complete / deep_dive_release:
--    ciclo del worker (solo service_role), con las reglas de ai_*_job. Al
--    reservar, un automático cuya postulación ya no está en entrevista se
--    cierra con «fuera_de_entrevista» sin llamar a la IA.
-- 4. anonymize_candidate: igual que en 20261118200100_guia_entrevista.sql, más
--    el borrado de las preguntas (pueden citar el CV).
-- =============================================================================

create table public.interview_deep_dives (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  origin public.ai_job_origin not null,
  status public.ai_job_status not null default 'pendiente',
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  attempts smallint not null default 0 check (attempts >= 0),
  -- Con qué se armó el prompt (se fija al empezar).
  evaluation_id uuid references public.candidate_evaluations (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,
  criteria_version integer check (criteria_version > 0),
  -- Lo que se pidió a la IA: [{requirement_id, kind}].
  requested_items jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_items) = 'array'),
  -- Lo que devolvió, validado: [{requirement_id, kind, question, listen_for}].
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  model text check (char_length(model) <= 100),
  prompt_version text check (char_length(prompt_version) <= 40),
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint interview_deep_dives_finished_consistency
    check ((status in ('completado', 'error')) = (finished_at is not null))
);

create unique index interview_deep_dives_one_open_idx
  on public.interview_deep_dives (application_id)
  where status in ('pendiente', 'procesando');
create index interview_deep_dives_queue_idx
  on public.interview_deep_dives (origin desc, requested_at)
  where status in ('pendiente', 'procesando');
create index interview_deep_dives_application_idx
  on public.interview_deep_dives (application_id, requested_at desc);

-- La auditoría guarda nombres de campos y los rastreados (status, origin), no el texto de las preguntas.
create trigger interview_deep_dives_audit after insert or update or delete on public.interview_deep_dives
  for each row execute function private.audit_row_change();

alter table public.interview_deep_dives enable row level security;

create policy interview_deep_dives_select on public.interview_deep_dives
  for select to authenticated
  using (private.is_staff() and private.can_access_application(application_id));

revoke all on table public.interview_deep_dives from anon, authenticated;
grant select on table public.interview_deep_dives to authenticated;

-- -----------------------------------------------------------------------------
-- Encolado
-- -----------------------------------------------------------------------------
create function private.enqueue_deep_dive_core(
  p_application_id uuid,
  p_origin public.ai_job_origin,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_resume uuid;
  v_eval_criteria integer;
  v_criteria integer;
  v_current_resume uuid;
  v_id uuid;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;
  if v_app.latest_evaluation_id is null then
    if p_origin = 'automatico' then
      return null;
    end if;
    raise exception 'La postulación aún no tiene evaluación del CV' using errcode = 'RH409';
  end if;

  -- La evaluación vigente debe ser de los criterios actuales y del CV vinculado
  -- (el que se enviaría a la IA): si no, sus citas no sirven y antes hay que volver a evaluar.
  select e.resume_id, e.criteria_version into v_resume, v_eval_criteria
  from public.candidate_evaluations e where e.id = v_app.latest_evaluation_id;
  select v.criteria_version into v_criteria from public.vacancies v where v.id = v_app.vacancy_id;
  v_current_resume := coalesce(
    v_app.resume_id,
    (select r.id from public.resumes r where r.candidate_id = v_app.candidate_id and r.is_current limit 1)
  );
  if v_eval_criteria is distinct from v_criteria
     or (v_current_resume is not null and v_resume is distinct from v_current_resume) then
    if p_origin = 'automatico' then
      return null;
    end if;
    raise exception 'La evaluación del CV está desactualizada: vuelva a evaluarlo' using errcode = 'RH409';
  end if;

  if p_origin = 'automatico' then
    -- No se repite: ya hay preguntas del mismo CV y la misma versión de criterios.
    if exists (
      select 1
      from public.interview_deep_dives d
      where d.application_id = v_app.id
        and d.status = 'completado'
        and d.resume_id is not distinct from v_resume
        and d.criteria_version = v_criteria
    ) then
      return null;
    end if;
  end if;

  insert into public.interview_deep_dives (application_id, origin, requested_by)
  values (v_app.id, p_origin, p_actor)
  on conflict (application_id) where status in ('pendiente', 'procesando') do nothing
  returning id into v_id;

  if v_id is null then
    -- Ya había uno abierto: se devuelve ese. Una solicitud manual adelanta a uno automático.
    select id into v_id
    from public.interview_deep_dives
    where application_id = v_app.id and status in ('pendiente', 'procesando');
    if p_origin = 'manual' then
      update public.interview_deep_dives
      set origin = 'manual', requested_by = coalesce(requested_by, p_actor), updated_at = now()
      where id = v_id and origin = 'automatico';
    end if;
  end if;
  return v_id;
end
$$;

revoke all on function private.enqueue_deep_dive_core(uuid, public.ai_job_origin, uuid)
  from public, anon, authenticated;

-- Personal: botón «Generar preguntas con IA» (manual) o al pasar a entrevista (automático, sin actor).
create function public.request_interview_deep_dive(p_application_id uuid, p_automatic boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() or not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return private.enqueue_deep_dive_core(
    p_application_id,
    case when p_automatic then 'automatico' else 'manual' end::public.ai_job_origin,
    case when p_automatic then null else (select auth.uid()) end
  );
end
$$;

revoke all on function public.request_interview_deep_dive(uuid, boolean) from public, anon;
grant execute on function public.request_interview_deep_dive(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Ciclo del worker (solo service_role, a través de /api/ia/trabajos/*)
-- -----------------------------------------------------------------------------

-- Reserva el siguiente por 10 minutos (primero los manuales). Cierra al
-- encontrarlos los que agotaron sus 3 intentos y los automáticos cuya
-- postulación ya no está en entrevista (no se gasta plan en ellos).
create function public.deep_dive_claim()
returns table (deep_dive_id uuid, application_id uuid, attempts smallint, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.interview_deep_dives%rowtype;
  v_status public.application_status;
  v_token uuid := gen_random_uuid();
begin
  loop
    select d.* into v_job
    from public.interview_deep_dives d
    where d.status in ('pendiente', 'procesando')
      and d.available_at <= now()
      and (d.claimed_at is null or d.claimed_at < now() - interval '10 minutes')
    order by d.origin desc, d.requested_at
    limit 1
    for update skip locked;

    if not found then
      return;
    end if;

    select a.status into v_status from public.applications a where a.id = v_job.application_id;

    if v_job.attempts >= 3 then
      update public.interview_deep_dives
      set status = 'error', error_code = 'demasiados_intentos', claimed_at = null, claim_token = null,
          finished_at = now(), updated_at = now()
      where id = v_job.id;
    elsif v_job.origin = 'automatico' and v_status not in ('entrevista_programada', 'en_evaluacion') then
      update public.interview_deep_dives
      set status = 'error', error_code = 'fuera_de_entrevista', claimed_at = null, claim_token = null,
          finished_at = now(), updated_at = now()
      where id = v_job.id;
    else
      exit;
    end if;
  end loop;

  update public.interview_deep_dives
  set status = 'procesando', claimed_at = now(), claim_token = v_token, attempts = v_job.attempts + 1,
      updated_at = now()
  where id = v_job.id;

  return query select v_job.id, v_job.application_id, (v_job.attempts + 1)::smallint, v_token;
end
$$;

-- Guarda con qué se armó el prompt y qué se pidió.
create function public.deep_dive_start(
  p_id uuid,
  p_token uuid,
  p_evaluation_id uuid,
  p_resume_id uuid,
  p_criteria_version integer,
  p_requested_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_requested_items is null or jsonb_typeof(p_requested_items) <> 'array' then
    raise exception 'Formato de lo pedido inválido' using errcode = 'RH422';
  end if;
  update public.interview_deep_dives
  set evaluation_id = p_evaluation_id,
      resume_id = p_resume_id,
      criteria_version = p_criteria_version,
      requested_items = p_requested_items,
      updated_at = now()
  where id = p_id and status = 'procesando' and claim_token = p_token;
  if not found then
    raise exception 'Trabajo no encontrado o no reservado' using errcode = 'RH404';
  end if;
end
$$;

-- Guarda las preguntas y cierra. Solo entran los pares (requisito, tipo) que se
-- pidieron, sin repetir y con los textos recortados. Sin ninguna válida: RH422.
create function public.deep_dive_complete(
  p_id uuid,
  p_token uuid,
  p_questions jsonb,
  p_model text,
  p_prompt_version text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.interview_deep_dives%rowtype;
  v_questions jsonb;
  v_count integer;
begin
  select * into v_job from public.interview_deep_dives where id = p_id for update;
  if not found or v_job.status <> 'procesando' or v_job.claim_token is distinct from p_token then
    raise exception 'Trabajo no encontrado o no reservado' using errcode = 'RH404';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'La respuesta no trae ninguna pregunta válida' using errcode = 'RH422';
  end if;

  with requested as (
    select r ->> 'requirement_id' as requirement_id, r ->> 'kind' as kind
    from jsonb_array_elements(v_job.requested_items) r
  ),
  answered as (
    select distinct on (q ->> 'requirement_id', q ->> 'kind')
      q ->> 'requirement_id' as requirement_id,
      q ->> 'kind' as kind,
      left(btrim(coalesce(q ->> 'question', '')), 300) as question,
      left(btrim(coalesce(q ->> 'listen_for', '')), 300) as listen_for,
      t.ord
    from jsonb_array_elements(p_questions) with ordinality as t(q, ord)
    where jsonb_typeof(q) = 'object'
    order by q ->> 'requirement_id', q ->> 'kind', t.ord
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object('requirement_id', a.requirement_id, 'kind', a.kind, 'question', a.question, 'listen_for', a.listen_for)
        order by a.ord
      ),
      '[]'::jsonb
    ),
    count(*)
  into v_questions, v_count
  from answered a
  join requested r on r.requirement_id = a.requirement_id and r.kind = a.kind
  where a.question <> '';

  if v_count = 0 then
    raise exception 'La respuesta no trae ninguna pregunta válida' using errcode = 'RH422';
  end if;

  update public.interview_deep_dives
  set status = 'completado',
      questions = v_questions,
      model = left(p_model, 100),
      prompt_version = left(p_prompt_version, 40),
      error_code = null,
      claimed_at = null,
      claim_token = null,
      finished_at = now(),
      updated_at = now()
  where id = p_id;
  return v_count;
end
$$;

-- Devuelve el trabajo a la cola o lo cierra con error (mismas reglas que ai_release_job):
--   reintentar  → falla transitoria; espera 2 min × intentos. Agotados → error.
--   limite      → límite del plan o sesión caducada; espera hasta p_retry_at (15 min). No cuenta intento.
--   reprogramar → los datos cambiaron; vuelve ya. No cuenta intento.
--   error       → falla definitiva.
create function public.deep_dive_release(
  p_id uuid,
  p_token uuid,
  p_outcome text,
  p_error_code text default null,
  p_retry_at timestamptz default null
)
returns public.ai_job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.interview_deep_dives%rowtype;
begin
  if p_outcome is null or p_outcome not in ('reintentar', 'limite', 'reprogramar', 'error') then
    raise exception 'Resultado inválido' using errcode = 'RH422';
  end if;
  if p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Código de error inválido' using errcode = 'RH422';
  end if;

  select * into v_job from public.interview_deep_dives where id = p_id for update;
  if not found or v_job.status <> 'procesando' or v_job.claim_token is distinct from p_token then
    raise exception 'Trabajo no encontrado o no reservado' using errcode = 'RH404';
  end if;

  if p_outcome = 'error' or (p_outcome = 'reintentar' and v_job.attempts >= 3) then
    update public.interview_deep_dives
    set status = 'error', error_code = coalesce(p_error_code, 'error'), claimed_at = null, claim_token = null,
        finished_at = now(), updated_at = now()
    where id = p_id;
    return 'error';
  end if;

  update public.interview_deep_dives
  set status = 'pendiente',
      claimed_at = null,
      claim_token = null,
      attempts = case when p_outcome in ('limite', 'reprogramar') then greatest(v_job.attempts - 1, 0) else v_job.attempts end,
      available_at = case p_outcome
        when 'limite' then least(
          greatest(coalesce(p_retry_at, now() + interval '15 minutes'), now() + interval '1 minute'),
          now() + interval '8 days'
        )
        when 'reintentar' then now() + make_interval(mins => 2 * v_job.attempts)
        else now()
      end,
      error_code = case p_outcome
        when 'limite' then coalesce(p_error_code, 'limite_plan')
        when 'reintentar' then coalesce(p_error_code, 'reintento')
        else null
      end,
      updated_at = now()
  where id = p_id;
  return 'pendiente';
end
$$;

revoke all on function public.deep_dive_claim() from public, anon, authenticated;
revoke all on function public.deep_dive_start(uuid, uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.deep_dive_complete(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.deep_dive_release(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.deep_dive_claim() to service_role;
grant execute on function public.deep_dive_start(uuid, uuid, uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.deep_dive_complete(uuid, uuid, jsonb, text, text) to service_role;
grant execute on function public.deep_dive_release(uuid, uuid, text, text, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- anonymize_candidate (igual que en 20261118200100_guia_entrevista.sql, más las preguntas)
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

  -- Preguntas para profundizar (20261120100000): pueden citar el CV. Los trabajos
  -- abiertos se cierran: su reserva deja de valer y el resultado que llegue se rechaza.
  update public.interview_deep_dives d
  set questions = '[]'::jsonb,
      status = case when d.status in ('pendiente', 'procesando') then 'error'::public.ai_job_status else d.status end,
      error_code = case when d.status in ('pendiente', 'procesando') then 'anonimizado' else d.error_code end,
      claimed_at = case when d.status in ('pendiente', 'procesando') then null else d.claimed_at end,
      claim_token = case when d.status in ('pendiente', 'procesando') then null else d.claim_token end,
      finished_at = case when d.status in ('pendiente', 'procesando') then now() else d.finished_at end,
      updated_at = now()
  from public.applications a
  where a.id = d.application_id and a.candidate_id = p_candidate_id
    and (d.questions <> '[]'::jsonb or d.status in ('pendiente', 'procesando'));

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
