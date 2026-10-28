-- =============================================================================
-- 2.2 · Formulario público de postulación
--
-- * Motivos de posible duplicado: pasan a applications.possible_duplicate_reasons
--   y a un único cálculo (private.duplicate_reasons) que usan la recepción de
--   Talent Apply y el formulario. application_overview los lee de applications.
-- * applications.public_reference: código corto que se entrega a la persona.
-- * consume_public_rate_limit: límites del formulario. El sujeto es un HMAC de
--   la IP (la IP nunca llega a la base de datos).
-- * public_form_challenges / consume_form_challenge: desafíos de un solo uso.
-- * submit_online_application: registro atómico de una postulación en línea
--   (solo service_role), con las dos constancias de consentimiento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas de applications
-- Las columnas nuevas no se agregan a los privilegios de INSERT/UPDATE de
-- `authenticated`: solo las funciones de servicio las escriben.
-- -----------------------------------------------------------------------------
alter table public.applications
  add column possible_duplicate_reasons text[] not null default '{}'
    check (possible_duplicate_reasons <@ array['correo', 'telefono', 'cv']::text[]),
  add column public_reference text
    check (public_reference ~ '^[A-HJ-NP-Z2-9]{8}$');

create unique index applications_public_reference_key
  on public.applications (public_reference) where public_reference is not null;

-- -----------------------------------------------------------------------------
-- 2. Cálculo de posibles duplicados (un solo lugar)
-- Recibe el correo y el teléfono YA normalizados (candidates.email_normalized y
-- phone_normalized). Nunca se fusionan fichas: solo se informa el motivo.
-- -----------------------------------------------------------------------------
create function private.duplicate_reasons(
  p_email text,
  p_phone text,
  p_sha256 text,
  p_exclude_candidate uuid
)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_remove(array[
    case when p_email is not null and exists (
      select 1 from public.candidates c
      where c.id <> p_exclude_candidate and c.email_normalized = p_email
    ) then 'correo' end,
    case when p_phone is not null and exists (
      select 1 from public.candidates c
      where c.id <> p_exclude_candidate and c.phone_normalized = p_phone
    ) then 'telefono' end,
    case when p_sha256 is not null and exists (
      select 1 from public.resumes r
      where r.candidate_id <> p_exclude_candidate and r.sha256 = p_sha256
    ) then 'cv' end
  ], null), '{}')
$$;

revoke all on function private.duplicate_reasons(text, text, text, uuid) from public, anon, authenticated;

-- Las filas existentes toman los motivos que ya guardó integration_submissions.
-- Sin disparadores de auditoría ni de fecha: es una migración de datos.
alter table public.applications disable trigger applications_audit;
alter table public.applications disable trigger applications_set_updated_at;
update public.applications a
   set possible_duplicate_reasons = s.duplicate_reasons
  from public.integration_submissions s
 where s.application_id = a.id
   and s.duplicate_reasons <> '{}';
alter table public.applications enable trigger applications_audit;
alter table public.applications enable trigger applications_set_updated_at;

-- -----------------------------------------------------------------------------
-- 3. Vista: possible_duplicate_reasons sale de applications (mismo nombre y
-- posición). Permisos y security_invoker se conservan con create or replace.
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
  a.possible_duplicate_reasons
from public.applications a
join public.candidates c on c.id = a.candidate_id
join public.vacancies v on v.id = a.vacancy_id
left join public.profiles ev on ev.id = a.assigned_evaluator_id
left join public.candidate_evaluations e on e.id = a.latest_evaluation_id
left join public.job_portals p on p.id = a.portal_id
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

-- -----------------------------------------------------------------------------
-- 4. register_integration_application: mismo contrato, con el helper y la
-- columna nueva (create or replace conserva los privilegios).
-- -----------------------------------------------------------------------------
create or replace function public.register_integration_application(
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
  v_duplicates := private.duplicate_reasons(v_email_norm, v_phone_norm, p_sha256, p_candidate_id);

  perform private.register_resume_core(
    p_resume_id, p_candidate_id, p_storage_path, p_original_filename, p_mime_type,
    p_size_bytes, p_sha256, p_extraction_status, p_extraction_method, p_extractor_version,
    p_raw_text, p_suggested_fields, p_warnings, p_error_code
  );

  -- Estado `nuevo`; el disparador registra `postulacion_creada` con actor nulo.
  insert into public.applications (
    candidate_id, vacancy_id, resume_id, portal_id, intake_method, possible_duplicate_reasons
  )
  values (p_candidate_id, v_vacancy.id, p_resume_id, v_portal.id, 'integracion', v_duplicates)
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

-- -----------------------------------------------------------------------------
-- 5. Límites del formulario público
-- 5 por hora por sujeto, 300 por hora por vacante y 1000 por día en total, sobre
-- la misma tabla private.rate_limits. `p_subject` es el HMAC-SHA256 de la IP en
-- hexadecimal (64 caracteres): cualquier otro formato se rechaza, de modo que
-- una IP en claro no puede llegar a la base de datos. Devuelve false si se
-- supera algún límite; un sujeto excedido no consume los límites globales.
-- -----------------------------------------------------------------------------
create function public.consume_public_rate_limit(p_subject text, p_vacancy_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_subject is null or p_subject !~ '^[0-9a-f]{64}$' then
    raise exception 'Sujeto no válido' using errcode = 'RH422';
  end if;
  if p_vacancy_code is null or p_vacancy_code !~ '^[a-z0-9]{10}$' then
    raise exception 'Código de vacante no válido' using errcode = 'RH422';
  end if;

  -- Limpieza ocasional de ventanas de sujetos ya vencidas.
  if random() < 0.02 then
    delete from private.rate_limits
     where key like 'public_apply:subject:%' and window_start < v_now - interval '2 hours';
  end if;

  insert into private.rate_limits as r (key, window_start, request_count)
  values ('public_apply:subject:' || p_subject, v_now, 1)
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
  if v_count > 5 then
    return false;
  end if;

  insert into private.rate_limits as r (key, window_start, request_count)
  values ('public_apply:vacancy:' || p_vacancy_code, v_now, 1)
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
  if v_count > 300 then
    return false;
  end if;

  insert into private.rate_limits as r (key, window_start, request_count)
  values ('public_apply:day', v_now, 1)
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

revoke all on function public.consume_public_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. Desafíos de un solo uso (prueba de trabajo del formulario)
-- Solo se guarda el hash del desafío firmado. Los de más de un día se borran
-- (el servidor ya rechaza los de más de 30 minutos).
-- -----------------------------------------------------------------------------
create table public.public_form_challenges (
  challenge_hash text primary key check (challenge_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz not null default now()
);

create index public_form_challenges_used_at_idx on public.public_form_challenges (used_at);

alter table public.public_form_challenges enable row level security;
revoke all on table public.public_form_challenges from anon, authenticated;

-- true si es la primera vez que se usa; false si ya se había usado.
create function public.consume_form_challenge(p_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Desafío no válido' using errcode = 'RH422';
  end if;

  delete from public.public_form_challenges where used_at < now() - interval '1 day';

  insert into public.public_form_challenges (challenge_hash)
  values (p_hash)
  on conflict (challenge_hash) do nothing
  returning challenge_hash into v_inserted;

  return v_inserted is not null;
end
$$;

revoke all on function public.consume_form_challenge(text) from public, anon, authenticated;
grant execute on function public.consume_form_challenge(text) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Postulación en línea
--
-- El servidor genera los ids y sube el archivo a su ruta definitiva ANTES de
-- llamar; si esta función falla, comprueba si el CV quedó registrado antes de
-- borrar el archivo. Siempre crea un candidato NUEVO: nunca modifica fichas.
-- Todo ocurre en una transacción: si un paso falla no queda nada registrado.
-- Errores: RH404 vacante inexistente o no pública, RH409 vacante cerrada o
-- vencida, RH412 el aviso ya no es el vigente, RH422 datos no válidos.
-- -----------------------------------------------------------------------------
create function public.submit_online_application(
  p_vacancy_code text,
  p_notice_id uuid,
  p_portal_name text,
  p_accept_talent_pool boolean,
  p_candidate_id uuid,
  p_resume_id uuid,
  p_storage_path text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_city text,
  p_linkedin_url text,
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
returns table (application_id uuid, public_reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.vacancies%rowtype;
  v_portal public.job_portals%rowtype;
  v_email_norm text;
  v_phone_norm text;
  v_duplicates text[];
  v_application_id uuid;
  v_reference text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_index integer;
  v_origins jsonb;
  v_city text := nullif(btrim(p_city), '');
  v_linkedin text := nullif(btrim(p_linkedin_url), '');
begin
  if p_accept_talent_pool is null then
    raise exception 'Indique si acepta la cartera de talento' using errcode = 'RH422';
  end if;

  -- 1. Vacante: mismo criterio que public_vacancies() y la recepción de Talent Apply.
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

  -- 2. Aviso: debe ser el vigente. Se bloquea la fila para que no se retire
  -- mientras se registran las constancias.
  perform 1 from public.privacy_notices n
   where n.id = p_notice_id and n.status = 'vigente'
     for share;
  if not found then
    raise exception 'El aviso de privacidad cambió' using errcode = 'RH412';
  end if;

  -- 3. Portal: solo «Página de empleos» o «Google», y activo.
  if p_portal_name is null or p_portal_name not in ('Página de empleos', 'Google') then
    raise exception 'Portal no válido' using errcode = 'RH422';
  end if;
  select * into v_portal from public.job_portals where name = p_portal_name and is_active;
  if not found then
    raise exception 'El portal no está disponible' using errcode = 'RH422';
  end if;

  -- 4. Candidato nuevo con los datos declarados.
  v_origins := jsonb_build_object('full_name', 'declarado', 'email', 'declarado');
  if nullif(btrim(p_phone), '') is not null then
    v_origins := v_origins || jsonb_build_object('phone', 'declarado');
  end if;
  if v_city is not null then
    v_origins := v_origins || jsonb_build_object('location', 'declarado');
  end if;
  if v_linkedin is not null then
    v_origins := v_origins || jsonb_build_object('linkedin_url', 'declarado');
  end if;
  insert into public.candidates (
    id, full_name, email, phone, location, linkedin_url, source, source_detail, field_origins
  )
  values (
    p_candidate_id, btrim(p_full_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''),
    v_city, v_linkedin, v_portal.candidate_source, v_portal.name, v_origins
  )
  returning email_normalized, phone_normalized into v_email_norm, v_phone_norm;

  v_duplicates := private.duplicate_reasons(v_email_norm, v_phone_norm, p_sha256, p_candidate_id);

  -- 5. CV y extracción (sin actor).
  perform private.register_resume_core(
    p_resume_id, p_candidate_id, p_storage_path, p_original_filename, p_mime_type,
    p_size_bytes, p_sha256, p_extraction_status, p_extraction_method, p_extractor_version,
    p_raw_text, p_suggested_fields, p_warnings, p_error_code
  );

  -- 6. Referencia pública: 8 caracteres de un alfabeto sin ambigüedades
  -- (A-H, J-N, P-Z, 2-9); se reintenta si ya existe (el índice único cubre la
  -- carrera residual). Los bytes 6 y 8 de un UUID v4 llevan bits fijos: no se usan.
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_reference := '';
    foreach v_index in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
      v_reference := v_reference || substr(v_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.applications a where a.public_reference = v_reference);
  end loop;

  insert into public.applications (
    candidate_id, vacancy_id, resume_id, portal_id, intake_method, public_reference, possible_duplicate_reasons
  )
  values (
    p_candidate_id, v_vacancy.id, p_resume_id, v_portal.id, 'formulario_en_linea', v_reference, v_duplicates
  )
  returning id into v_application_id;

  -- 7. Constancias: selección (siempre) y cartera de talento (según la casilla).
  perform private.record_consent(
    p_candidate_id, v_application_id, p_notice_id, 'proceso_seleccion', true, 'formulario_en_linea', null
  );
  perform private.record_consent(
    p_candidate_id, v_application_id, p_notice_id, 'cartera_talento', p_accept_talent_pool, 'formulario_en_linea', null
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    'formulario_postulacion',
    'applications',
    v_application_id::text,
    jsonb_build_object(
      'intake_method', 'formulario_en_linea',
      'portal_id', v_portal.id,
      'portal', v_portal.name,
      'notice_id', p_notice_id,
      'talent_pool', p_accept_talent_pool,
      'duplicate_reasons', to_jsonb(v_duplicates)
    )
  );

  return query select v_application_id, v_reference;
end
$$;

revoke all on function public.submit_online_application(
  text, uuid, text, boolean, uuid, uuid, text, text, text, text, text, text, text, text, integer,
  text, public.extraction_status, text, text, text, jsonb, text[], text
) from public, anon, authenticated;
grant execute on function public.submit_online_application(
  text, uuid, text, boolean, uuid, uuid, text, text, text, text, text, text, text, text, integer,
  text, public.extraction_status, text, text, text, jsonb, text[], text
) to service_role;
