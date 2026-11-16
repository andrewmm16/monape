-- =============================================================================
-- 0041 · Corrige 0040: `on conflict (application_id, ...)` era ambiguo con la
-- columna de salida `application_id` de la función. Se usa el nombre de la
-- restricción única.
-- =============================================================================

create or replace function public.submit_online_application(
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
  p_error_code text,
  p_killer_answers jsonb default '[]'
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
  v_answer jsonb;
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

  -- 8. Respuestas a preguntas eliminatorias: solo se registran y se marcan
  -- (meets); nunca cambian el estado ni impiden la postulación.
  if p_killer_answers is not null and jsonb_typeof(p_killer_answers) <> 'array' then
    raise exception 'Respuestas no válidas' using errcode = 'RH422';
  end if;
  for v_answer in select * from jsonb_array_elements(coalesce(p_killer_answers, '[]'::jsonb)) loop
    -- Pregunta borrada (o ajena) mientras se postulaba: se omite la respuesta.
    if not exists (
      select 1 from public.vacancy_killer_questions kq
       where kq.id = (v_answer ->> 'question_id')::uuid and kq.vacancy_id = v_vacancy.id
    ) then
      continue;
    end if;
    insert into public.application_killer_answers (
      application_id, question_id, answer_boolean, answer_number, answer_text, meets
    )
    values (
      v_application_id,
      (v_answer ->> 'question_id')::uuid,
      (v_answer ->> 'answer_boolean')::boolean,
      (v_answer ->> 'answer_number')::numeric,
      v_answer ->> 'answer_text',
      false -- provisional: el trigger lo recalcula
    )
    on conflict on constraint application_killer_answers_application_id_question_id_key do nothing;
  end loop;

  return query select v_application_id, v_reference;
end
$$;
