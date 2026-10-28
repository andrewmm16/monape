-- =============================================================================
-- 2.10 · Recepción de Talent Apply
--
-- Talent.com envía cada postulación hecha en su sitio por POST a un endpoint de
-- la aplicación. Esta migración agrega lo que la base de datos necesita:
--
-- * Portal «Trabajos Diarios» en el catálogo.
-- * Evaluación y registro de CV sin usuario: la lógica pasa a funciones
--   privadas con el actor como parámetro; las funciones públicas de siempre
--   conservan su firma y exigen personal. `record_system_evaluation` (solo
--   service_role) llama al núcleo con actor nulo.
-- * integration_submissions: una fila por postulación recibida (idempotencia
--   por id externo). Sin IP, user agent ni carga cruda.
-- * register_integration_application: registro atómico (solo service_role).
-- * consume_integration_rate_limit: límite sin IP por vacante y por día.
-- * application_overview: agrega possible_duplicate_reasons.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo
-- -----------------------------------------------------------------------------
insert into public.job_portals (name, kind, candidate_source, position)
values ('Trabajos Diarios', 'manual', 'bolsa_empleo', 135)
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- 2a. record_evaluation: núcleo privado con el actor como parámetro
-- Mismas validaciones que antes, salvo la de personal (la hace quien llama).
-- -----------------------------------------------------------------------------
create function private.record_evaluation_core(
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
  values (v_app.id, 'evaluacion_generada', p_actor);

  return v_eval_id;
end
$$;

revoke all on function private.record_evaluation_core(
  uuid, uuid, integer, public.evaluation_method, text, text, text, numeric, numeric,
  numeric, public.compatibility_level, text, text[], text, jsonb, uuid
) from public, anon, authenticated;

-- Misma firma y mismos privilegios que antes: exige personal.
create or replace function public.record_evaluation(
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
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return private.record_evaluation_core(
    p_application_id, p_resume_id, p_criteria_version, p_method, p_method_version,
    p_scoring_version, p_model, p_score, p_score_potential, p_evidence_coverage, p_level,
    p_summary, p_limitations, p_input_sha256, p_items, (select auth.uid())
  );
end
$$;

-- Evaluación registrada por el sistema (integraciones): actor nulo. Solo service_role.
create function public.record_system_evaluation(
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
language sql
security definer
set search_path = ''
as $$
  select private.record_evaluation_core(
    p_application_id, p_resume_id, p_criteria_version, p_method, p_method_version,
    p_scoring_version, p_model, p_score, p_score_potential, p_evidence_coverage, p_level,
    p_summary, p_limitations, p_input_sha256, p_items, null
  )
$$;

revoke all on function public.record_system_evaluation(
  uuid, uuid, integer, public.evaluation_method, text, text, text, numeric, numeric,
  numeric, public.compatibility_level, text, text[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_system_evaluation(
  uuid, uuid, integer, public.evaluation_method, text, text, text, numeric, numeric,
  numeric, public.compatibility_level, text, text[], text, jsonb
) to service_role;

-- -----------------------------------------------------------------------------
-- 2b. register_resume: núcleo privado sin la comprobación de personal
-- -----------------------------------------------------------------------------
create function private.register_resume_core(
  p_resume_id uuid,
  p_candidate_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes integer,
  p_sha256 text,
  p_extraction_status public.extraction_status,
  p_extraction_method text,
  p_extractor_version text,
  p_raw_text text,
  p_suggested_fields jsonb,
  p_warnings text[],
  p_error_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not exists (select 1 from public.candidates where id = p_candidate_id) then
    raise exception 'Candidato no encontrado' using errcode = 'RH404';
  end if;

  insert into public.resumes (id, candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
  values (p_resume_id, p_candidate_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, p_sha256)
  returning version into v_version;

  insert into public.resume_extractions (
    resume_id, status, method, extractor_version, raw_text, suggested_fields, warnings, error_code
  )
  values (
    p_resume_id, p_extraction_status, p_extraction_method, p_extractor_version, p_raw_text,
    coalesce(p_suggested_fields, '{}'::jsonb), coalesce(p_warnings, '{}'), p_error_code
  );

  -- Las postulaciones sin CV asociado pasan a usar esta versión.
  update public.applications
  set resume_id = p_resume_id
  where candidate_id = p_candidate_id and resume_id is null;

  return v_version;
end
$$;

revoke all on function private.register_resume_core(
  uuid, uuid, text, text, text, integer, text, public.extraction_status, text, text, text, jsonb, text[], text
) from public, anon, authenticated;

create or replace function public.register_resume(
  p_resume_id uuid,
  p_candidate_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes integer,
  p_sha256 text,
  p_extraction_status public.extraction_status,
  p_extraction_method text,
  p_extractor_version text,
  p_raw_text text,
  p_suggested_fields jsonb,
  p_warnings text[],
  p_error_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return private.register_resume_core(
    p_resume_id, p_candidate_id, p_storage_path, p_original_filename, p_mime_type,
    p_size_bytes, p_sha256, p_extraction_status, p_extraction_method, p_extractor_version,
    p_raw_text, p_suggested_fields, p_warnings, p_error_code
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Postulaciones recibidas por integraciones
-- Sin IP, user agent ni carga cruda; `reason` es un código corto, nunca datos
-- personales. El personal solo lee; únicamente las funciones de abajo escriben.
-- -----------------------------------------------------------------------------
create table public.integration_submissions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('talent_apply')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  vacancy_id uuid references public.vacancies (id) on delete set null,
  candidate_id uuid references public.candidates (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  status text not null check (status in ('registrada', 'rechazada')),
  reason text check (reason ~ '^[a-z0-9_]{1,64}$'),
  duplicate_reasons text[] not null default '{}'
    check (duplicate_reasons <@ array['correo', 'telefono', 'cv']::text[]),
  received_at timestamptz not null default now(),
  constraint integration_submissions_external_key unique (provider, external_id),
  constraint integration_submissions_rejected_check
    check (status <> 'rechazada' or (candidate_id is null and application_id is null))
);

create unique index integration_submissions_application_idx
  on public.integration_submissions (application_id) where application_id is not null;
create index integration_submissions_vacancy_idx on public.integration_submissions (vacancy_id);

alter table public.integration_submissions enable row level security;

create policy integration_submissions_select on public.integration_submissions
  for select to authenticated using (private.is_staff());

revoke all on table public.integration_submissions from anon, authenticated;
grant select on table public.integration_submissions to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Registro atómico de una postulación recibida
--
-- El servidor genera los ids y sube el archivo a su ruta definitiva ANTES de
-- llamar; si esta función falla o la postulación ya estaba registrada, borra el
-- archivo. Siempre crea un candidato NUEVO: nunca modifica fichas existentes.
-- Errores: RH404 vacante inexistente o no pública, RH409 vacante cerrada.
-- -----------------------------------------------------------------------------
create function public.register_integration_application(
  p_provider text,
  p_external_id text,
  p_vacancy_code text,
  p_candidate_id uuid,
  p_resume_id uuid,
  p_storage_path text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes integer,
  p_sha256 text,
  p_extraction_status public.extraction_status,
  p_extraction_method text,
  p_extractor_version text,
  p_raw_text text,
  p_suggested_fields jsonb,
  p_warnings text[],
  p_error_code text
)
returns table (application_id uuid, already_registered boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.integration_submissions%rowtype;
  v_vacancy public.vacancies%rowtype;
  v_portal public.job_portals%rowtype;
  v_email_norm text;
  v_phone_norm text;
  v_duplicates text[];
  v_application_id uuid;
  v_submission_id uuid;
  v_origins jsonb;
begin
  if p_provider is distinct from 'talent_apply' then
    raise exception 'Proveedor no válido' using errcode = 'RH422';
  end if;
  if p_external_id is null or char_length(p_external_id) not between 1 and 200 then
    raise exception 'Identificador externo no válido' using errcode = 'RH422';
  end if;

  -- Una sola ejecución a la vez por postulación externa.
  perform pg_advisory_xact_lock(hashtextextended('integration:' || p_provider || ':' || p_external_id, 0));

  select * into v_existing
  from public.integration_submissions s
  where s.provider = p_provider and s.external_id = p_external_id;
  if found and v_existing.status = 'registrada' then
    return query select v_existing.application_id, true;
    return;
  end if;

  -- Mismo criterio que public_vacancies(): publicada, no confidencial, con los
  -- datos públicos y con la fecha de cierre sin vencer (hora de Lima).
  select * into v_vacancy from public.vacancies v where v.public_code = p_vacancy_code for share;
  if not found or v_vacancy.is_confidential or v_vacancy.first_published_at is null
     or v_vacancy.status not in ('publicada', 'cerrada') then
    raise exception 'La vacante no existe' using errcode = 'RH404';
  end if;
  if v_vacancy.status = 'cerrada'
     or (v_vacancy.closing_date is not null
         and v_vacancy.closing_date < (now() at time zone 'America/Lima')::date) then
    raise exception 'La vacante ya no recibe postulaciones' using errcode = 'RH409';
  end if;
  if not private.vacancy_has_public_data(v_vacancy) then
    raise exception 'La vacante no existe' using errcode = 'RH404';
  end if;

  select * into v_portal from public.job_portals where name = 'Talent.com';
  if not found then
    raise exception 'Falta el portal Talent.com en el catálogo' using errcode = 'RH404';
  end if;

  -- Candidato nuevo, con los datos declarados por la persona.
  v_origins := jsonb_build_object('full_name', 'declarado', 'email', 'declarado');
  if nullif(btrim(p_phone), '') is not null then
    v_origins := v_origins || jsonb_build_object('phone', 'declarado');
  end if;
  insert into public.candidates (id, full_name, email, phone, source, source_detail, field_origins)
  values (
    p_candidate_id, btrim(p_full_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''),
    v_portal.candidate_source, v_portal.name, v_origins
  )
  returning email_normalized, phone_normalized into v_email_norm, v_phone_norm;

  -- Posibles duplicados frente a los demás candidatos (nunca se fusionan).
  select coalesce(array_remove(array[
    case when v_email_norm is not null and exists (
      select 1 from public.candidates c
      where c.id <> p_candidate_id and c.email_normalized = v_email_norm
    ) then 'correo' end,
    case when v_phone_norm is not null and exists (
      select 1 from public.candidates c
      where c.id <> p_candidate_id and c.phone_normalized = v_phone_norm
    ) then 'telefono' end,
    case when exists (
      select 1 from public.resumes r
      where r.candidate_id <> p_candidate_id and r.sha256 = p_sha256
    ) then 'cv' end
  ], null), '{}')
  into v_duplicates;

  perform private.register_resume_core(
    p_resume_id, p_candidate_id, p_storage_path, p_original_filename, p_mime_type,
    p_size_bytes, p_sha256, p_extraction_status, p_extraction_method, p_extractor_version,
    p_raw_text, p_suggested_fields, p_warnings, p_error_code
  );

  -- Estado `nuevo`; el disparador registra `postulacion_creada` con actor nulo.
  insert into public.applications (candidate_id, vacancy_id, resume_id, portal_id, intake_method)
  values (p_candidate_id, v_vacancy.id, p_resume_id, v_portal.id, 'integracion')
  returning id into v_application_id;

  if v_existing.id is not null then
    -- Había una recepción rechazada con este id: ahora queda registrada.
    update public.integration_submissions
    set vacancy_id = v_vacancy.id,
        candidate_id = p_candidate_id,
        application_id = v_application_id,
        status = 'registrada',
        reason = null,
        duplicate_reasons = v_duplicates,
        received_at = now()
    where id = v_existing.id
    returning id into v_submission_id;
  else
    insert into public.integration_submissions (
      provider, external_id, vacancy_id, candidate_id, application_id, status, duplicate_reasons
    )
    values (
      p_provider, p_external_id, v_vacancy.id, p_candidate_id, v_application_id, 'registrada', v_duplicates
    )
    returning id into v_submission_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    'integracion_postulacion',
    'applications',
    v_application_id::text,
    jsonb_build_object(
      'provider', p_provider,
      'intake_method', 'integracion',
      'portal_id', v_portal.id,
      'portal', v_portal.name,
      'submission_id', v_submission_id,
      'duplicate_reasons', to_jsonb(v_duplicates)
    )
  );

  return query select v_application_id, false;
end
$$;

-- Deja constancia de una postulación rechazada (p. ej. CV inválido). Solo un
-- código corto como motivo. No sustituye a una ya registrada.
create function public.reject_integration_submission(
  p_provider text,
  p_external_id text,
  p_vacancy_code text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider is distinct from 'talent_apply' then
    raise exception 'Proveedor no válido' using errcode = 'RH422';
  end if;
  if p_external_id is null or char_length(p_external_id) not between 1 and 200 then
    raise exception 'Identificador externo no válido' using errcode = 'RH422';
  end if;
  if p_reason is null or p_reason !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Motivo no válido' using errcode = 'RH422';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('integration:' || p_provider || ':' || p_external_id, 0));

  insert into public.integration_submissions (provider, external_id, vacancy_id, status, reason)
  values (
    p_provider, p_external_id,
    (select v.id from public.vacancies v where v.public_code = p_vacancy_code),
    'rechazada', p_reason
  )
  on conflict (provider, external_id) do nothing;
end
$$;

revoke all on function public.register_integration_application(
  text, text, text, uuid, uuid, text, text, text, text, text, text, integer, text,
  public.extraction_status, text, text, text, jsonb, text[], text
) from public, anon, authenticated;
grant execute on function public.register_integration_application(
  text, text, text, uuid, uuid, text, text, text, text, text, text, integer, text,
  public.extraction_status, text, text, text, jsonb, text[], text
) to service_role;

revoke all on function public.reject_integration_submission(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reject_integration_submission(text, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Límite de solicitudes de integración (sin IP)
-- 200 por hora por vacante y 1000 por día en total. Ventana fija sobre la misma
-- tabla private.rate_limits que usa consume_rate_limit. Devuelve false si se
-- supera algún límite.
-- -----------------------------------------------------------------------------
create function public.consume_integration_rate_limit(p_provider text, p_vacancy_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_key text;
begin
  if p_provider is distinct from 'talent_apply' then
    raise exception 'Proveedor no válido' using errcode = 'RH422';
  end if;
  if p_vacancy_code is null or p_vacancy_code !~ '^[a-z0-9]{10}$' then
    raise exception 'Código de vacante no válido' using errcode = 'RH422';
  end if;

  v_key := 'integration:' || p_provider || ':vacancy:' || p_vacancy_code;
  insert into private.rate_limits as r (key, window_start, request_count)
  values (v_key, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - interval '1 hour' then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - interval '1 hour' then v_now
          else r.window_start
        end
  returning request_count into v_count;
  if v_count > 200 then
    return false;
  end if;

  v_key := 'integration:' || p_provider || ':day';
  insert into private.rate_limits as r (key, window_start, request_count)
  values (v_key, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - interval '24 hours' then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - interval '24 hours' then v_now
          else r.window_start
        end
  returning request_count into v_count;
  return v_count <= 1000;
end
$$;

revoke all on function public.consume_integration_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_integration_rate_limit(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. Vista: possible_duplicate_reasons al final (permisos y propiedades se
-- conservan con create or replace).
-- -----------------------------------------------------------------------------
create or replace view public.application_overview
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
  coalesce(m.top_pending, '{}') as top_pending,
  v.status as vacancy_status,
  a.opinion_requested_at,
  a.opinion_answered_at,
  p.name as portal_name,
  a.intake_method,
  a.portal_id,
  coalesce(s.duplicate_reasons, '{}') as possible_duplicate_reasons
from public.applications a
join public.candidates c on c.id = a.candidate_id
join public.vacancies v on v.id = a.vacancy_id
left join public.profiles ev on ev.id = a.assigned_evaluator_id
left join public.candidate_evaluations e on e.id = a.latest_evaluation_id
left join public.job_portals p on p.id = a.portal_id
left join public.integration_submissions s on s.application_id = a.id
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
