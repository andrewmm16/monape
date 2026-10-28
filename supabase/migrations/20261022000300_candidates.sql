-- =============================================================================
-- 0003 · Candidatos, CV, extracciones, perfil profesional y postulaciones
-- =============================================================================

create type public.candidate_source as enum (
  'manual', 'bolsa_empleo', 'linkedin', 'referido', 'web_empresa', 'otro'
);
-- Origen de un dato: declarado por el candidato, extraído automáticamente del
-- CV o verificado por una persona de RRHH.
create type public.data_origin as enum ('declarado', 'extraido', 'verificado');
create type public.profile_item_kind as enum (
  'experiencia', 'formacion', 'habilidad', 'certificacion', 'idioma'
);
create type public.extraction_status as enum ('completada', 'sin_texto', 'fallida');
create type public.application_status as enum (
  'nuevo',
  'en_revision',
  'preseleccionado',
  'entrevista_programada',
  'en_evaluacion',
  'seleccionado',
  'no_seleccionado',
  'en_reserva',
  'retirado'
);
create type public.application_event_type as enum (
  'postulacion_creada',
  'cambio_estado',
  'evaluacion_generada',
  'evaluacion_revisada',
  'observacion'
);

-- -----------------------------------------------------------------------------
-- Normalización para detección de posibles duplicados
-- -----------------------------------------------------------------------------
create function private.normalize_person_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      translate(lower(coalesce(p_value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
      '\s+', ' ', 'g'
    )),
    ''
  )
$$;

create function private.normalize_phone(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) >= 7
      then right(regexp_replace(p_value, '\D', '', 'g'), 9)
  end
$$;

create function private.is_valid_origin_map(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_value) e
      where jsonb_typeof(e.value) <> 'string'
         or (e.value #>> '{}') not in ('declarado', 'extraido', 'verificado')
    )
$$;

revoke all on function private.normalize_person_name(text) from public;
revoke all on function private.normalize_phone(text) from public;
revoke all on function private.is_valid_origin_map(jsonb) from public;
grant execute on function private.normalize_person_name(text) to authenticated, service_role;
grant execute on function private.normalize_phone(text) to authenticated, service_role;
grant execute on function private.is_valid_origin_map(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Candidatos
-- -----------------------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 160),
  email text check (
    email is null
    or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  phone text check (char_length(phone) <= 40),
  location text check (char_length(location) <= 160),
  linkedin_url text check (char_length(linkedin_url) <= 300),
  source public.candidate_source not null default 'manual',
  source_detail text check (char_length(source_detail) <= 200),
  -- Origen de cada campo: {"email": "extraido", "phone": "verificado", ...}
  field_origins jsonb not null default '{}'::jsonb
    check (private.is_valid_origin_map(field_origins)),
  email_normalized text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone_normalized text generated always as (private.normalize_phone(phone)) stored,
  name_normalized text generated always as (private.normalize_person_name(full_name)) stored,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidates_email_normalized_idx on public.candidates (email_normalized);
create index candidates_phone_normalized_idx on public.candidates (phone_normalized);
create index candidates_name_normalized_idx on public.candidates (name_normalized);
create index candidates_created_at_idx on public.candidates (created_at desc);

-- -----------------------------------------------------------------------------
-- CV (versionados). El archivo vive en el bucket privado `resumes` bajo
-- candidates/{candidate_id}/{archivo}.
-- -----------------------------------------------------------------------------
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- Asignada por el disparador resumes_prepare_version (correlativa por candidato).
  version integer not null default 1 check (version > 0),
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default true,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint resumes_candidate_version_key unique (candidate_id, version),
  constraint resumes_id_candidate_key unique (id, candidate_id),
  constraint resumes_storage_path_check
    check (storage_path like 'candidates/' || candidate_id::text || '/%')
);

create unique index resumes_one_current_idx on public.resumes (candidate_id) where is_current;

create table public.resume_extractions (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null unique references public.resumes (id) on delete cascade,
  status public.extraction_status not null,
  method text not null check (method in ('pdf_text', 'docx_text')),
  extractor_version text not null check (char_length(extractor_version) <= 40),
  raw_text text check (char_length(raw_text) <= 200000),
  -- Texto corregido manualmente por RRHH; tiene prioridad sobre raw_text.
  corrected_text text check (char_length(corrected_text) <= 200000),
  corrected_by uuid references public.profiles (id) on delete set null,
  corrected_at timestamptz,
  -- Sugerencias detectadas (correo, teléfono, habilidades...). Nunca se
  -- aplican al candidato sin una acción de RRHH.
  suggested_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(suggested_fields) = 'object'),
  warnings text[] not null default '{}',
  error_code text check (char_length(error_code) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Perfil profesional (experiencia, formación, habilidades, certificaciones)
-- -----------------------------------------------------------------------------
create table public.candidate_profile_items (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  kind public.profile_item_kind not null,
  title text not null check (char_length(title) between 1 and 200),
  organization text check (char_length(organization) <= 200),
  start_date date,
  end_date date,
  description text check (char_length(description) <= 2000),
  origin public.data_origin not null default 'declarado',
  source_resume_id uuid,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_profile_items_dates_check
    check (end_date is null or start_date is null or end_date >= start_date),
  constraint candidate_profile_items_verified_check
    check ((origin = 'verificado') = (verified_at is not null)),
  -- El CV de origen debe pertenecer al mismo candidato.
  constraint candidate_profile_items_resume_fk foreign key (source_resume_id, candidate_id)
    references public.resumes (id, candidate_id) on delete set null (source_resume_id)
);

create index candidate_profile_items_candidate_idx on public.candidate_profile_items (candidate_id, kind);

-- -----------------------------------------------------------------------------
-- Postulaciones (candidato × vacante) e historial del proceso
-- -----------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- Una vacante con postulaciones no se elimina: se archiva.
  vacancy_id uuid not null references public.vacancies (id) on delete restrict,
  resume_id uuid,
  status public.application_status not null default 'nuevo',
  assigned_evaluator_id uuid references public.profiles (id) on delete set null,
  latest_evaluation_id uuid,
  applied_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_candidate_vacancy_key unique (candidate_id, vacancy_id),
  constraint applications_resume_fk foreign key (resume_id, candidate_id)
    references public.resumes (id, candidate_id) on delete set null (resume_id)
);

create index applications_vacancy_status_idx on public.applications (vacancy_id, status);
create index applications_candidate_idx on public.applications (candidate_id);
create index applications_evaluator_idx on public.applications (assigned_evaluator_id);

create table public.application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  event_type public.application_event_type not null,
  from_status public.application_status,
  to_status public.application_status,
  reason text check (char_length(reason) <= 500),
  note text check (char_length(note) <= 4000),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint application_events_note_required
    check (event_type <> 'observacion' or char_length(btrim(coalesce(note, ''))) > 0),
  constraint application_events_status_change
    check (event_type <> 'cambio_estado' or (from_status is not null and to_status is not null))
);

create index application_events_application_idx on public.application_events (application_id, created_at desc);
create index application_events_created_at_idx on public.application_events (created_at desc);

-- -----------------------------------------------------------------------------
-- Acceso a candidatos y postulaciones
-- -----------------------------------------------------------------------------
create function private.can_access_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff() or (
    private.is_active_user() and exists (
      select 1
      from public.applications a
      join public.vacancy_members m on m.vacancy_id = a.vacancy_id
      where a.id = p_application_id
        and m.profile_id = (select auth.uid())
    )
  )
$$;

create function private.can_access_candidate(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff() or (
    private.is_active_user() and exists (
      select 1
      from public.applications a
      join public.vacancy_members m on m.vacancy_id = a.vacancy_id
      where a.candidate_id = p_candidate_id
        and m.profile_id = (select auth.uid())
    )
  )
$$;

revoke all on function private.can_access_application(uuid) from public;
revoke all on function private.can_access_candidate(uuid) from public;
grant execute on function private.can_access_application(uuid) to authenticated, service_role;
grant execute on function private.can_access_candidate(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Disparadores de negocio
-- -----------------------------------------------------------------------------

-- Versionado de CV: asigna versión correlativa y marca el nuevo como vigente.
create function private.prepare_resume_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('resume:' || new.candidate_id::text, 0));

  select coalesce(max(r.version), 0) + 1
  into new.version
  from public.resumes r
  where r.candidate_id = new.candidate_id;

  update public.resumes
  set is_current = false
  where candidate_id = new.candidate_id
    and is_current;

  new.is_current := true;
  return new;
end
$$;

create trigger resumes_prepare_version
  before insert on public.resumes
  for each row execute function private.prepare_resume_version();

create function private.track_extraction_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.corrected_text is distinct from old.corrected_text then
    new.corrected_by := (select auth.uid());
    new.corrected_at := case when new.corrected_text is null then null else now() end;
  end if;
  return new;
end
$$;

create trigger resume_extractions_track_correction
  before update on public.resume_extractions
  for each row execute function private.track_extraction_correction();

create function private.track_profile_item_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origin = 'verificado' then
    if tg_op = 'INSERT' or old.origin <> 'verificado' then
      new.verified_by := (select auth.uid());
      new.verified_at := now();
    end if;
  else
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end
$$;

create trigger candidate_profile_items_track_verification
  before insert or update on public.candidate_profile_items
  for each row execute function private.track_profile_item_verification();

-- Solo se registran postulaciones en vacantes en borrador o publicadas.
create function private.check_application_vacancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.vacancies v
    where v.id = new.vacancy_id and v.status in ('borrador', 'publicada')
  ) then
    raise exception 'La vacante no admite nuevas postulaciones' using errcode = 'RH409';
  end if;
  return new;
end
$$;

create trigger applications_check_vacancy
  before insert on public.applications
  for each row execute function private.check_application_vacancy();

create function private.log_application_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.application_events (application_id, event_type, to_status, actor_id)
  values (new.id, 'postulacion_creada', new.status, (select auth.uid()));
  return null;
end
$$;

create trigger applications_log_created
  after insert on public.applications
  for each row execute function private.log_application_created();

-- Cambio de estado del proceso: único camino para modificar `status`. Registra
-- estado anterior, nuevo, responsable, fecha y motivo.
create function public.change_application_status(
  p_application_id uuid,
  p_new_status public.application_status,
  p_reason text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.application_status;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select a.status into v_old
  from public.applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;
  if exists (
    select 1 from public.applications a
    join public.vacancies v on v.id = a.vacancy_id
    where a.id = p_application_id and v.status = 'archivada'
  ) then
    raise exception 'La vacante está archivada' using errcode = 'RH409';
  end if;
  if v_old = p_new_status then
    raise exception 'La postulación ya se encuentra en ese estado' using errcode = 'RH409';
  end if;
  if p_new_status in ('no_seleccionado', 'retirado')
     and char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Debe indicar el motivo del cambio de estado' using errcode = 'RH422';
  end if;

  update public.applications
  set status = p_new_status,
      status_changed_at = now()
  where id = p_application_id;

  insert into public.application_events (
    application_id, event_type, from_status, to_status, reason, note, actor_id
  )
  values (
    p_application_id,
    'cambio_estado',
    v_old,
    p_new_status,
    nullif(btrim(p_reason), ''),
    nullif(btrim(p_note), ''),
    (select auth.uid())
  );
end
$$;

revoke all on function public.change_application_status(uuid, public.application_status, text, text) from public, anon;
grant execute on function public.change_application_status(uuid, public.application_status, text, text) to authenticated;

-- Búsqueda de posibles duplicados (correo, teléfono o nombre normalizado).
create function public.find_candidate_duplicates(
  p_email text,
  p_phone text,
  p_full_name text,
  p_exclude_id uuid default null
)
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  match_reasons text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select
      nullif(lower(btrim(p_email)), '') as email,
      private.normalize_phone(p_phone) as phone,
      private.normalize_person_name(p_full_name) as name
  )
  select
    c.id,
    c.full_name,
    c.email,
    c.phone,
    array_remove(array[
      case when c.email_normalized = i.email then 'correo' end,
      case when c.phone_normalized = i.phone then 'telefono' end,
      case when c.name_normalized = i.name then 'nombre' end
    ], null) as match_reasons
  from public.candidates c
  cross join input i
  where (p_exclude_id is null or c.id <> p_exclude_id)
    and (
      c.email_normalized = i.email
      or c.phone_normalized = i.phone
      or c.name_normalized = i.name
    )
  order by c.created_at desc
  limit 10
$$;

revoke all on function public.find_candidate_duplicates(text, text, text, uuid) from public, anon;
grant execute on function public.find_candidate_duplicates(text, text, text, uuid) to authenticated;

-- Registro atómico de un CV ya almacenado y de su extracción: o se guardan
-- ambos o ninguno (evita versiones vigentes sin texto).
create function public.register_resume(
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
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
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

revoke all on function public.register_resume(
  uuid, uuid, text, text, text, integer, text, public.extraction_status, text, text, text, jsonb, text[], text
) from public, anon;
grant execute on function public.register_resume(
  uuid, uuid, text, text, text, integer, text, public.extraction_status, text, text, text, jsonb, text[], text
) to authenticated;

-- Auditoría de descargas de CV: solo para CV a los que el usuario tiene acceso.
create function public.log_resume_download(p_resume_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate_id uuid;
begin
  select r.candidate_id into v_candidate_id from public.resumes r where r.id = p_resume_id;
  if v_candidate_id is null or not private.can_access_candidate(v_candidate_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'cv_descargado',
    'resumes',
    p_resume_id::text,
    jsonb_build_object('candidate_id', v_candidate_id)
  );
end
$$;

revoke all on function public.log_resume_download(uuid) from public, anon;
grant execute on function public.log_resume_download(uuid) to authenticated;

-- El responsable de evaluación debe poder ver la postulación: un evaluador
-- debe formar parte del equipo de la vacante.
create function private.check_assigned_evaluator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_evaluator_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.assigned_evaluator_id
      and p.is_active
      and (
        p.role in ('admin', 'rrhh')
        or exists (
          select 1 from public.vacancy_members m
          where m.vacancy_id = new.vacancy_id and m.profile_id = p.id
        )
      )
  ) then
    raise exception 'El responsable debe estar activo y, si es evaluador, formar parte del equipo de la vacante'
      using errcode = 'RH422';
  end if;
  return new;
end
$$;

create trigger applications_check_assigned_evaluator
  before insert or update of assigned_evaluator_id on public.applications
  for each row execute function private.check_assigned_evaluator();

-- updated_at / autoría / auditoría
create trigger candidates_set_updated_at before update on public.candidates
  for each row execute function private.set_updated_at();
create trigger candidates_set_created_by before insert on public.candidates
  for each row execute function private.set_actor_column('created_by');
create trigger resumes_set_uploaded_by before insert on public.resumes
  for each row execute function private.set_actor_column('uploaded_by');
create trigger resume_extractions_set_updated_at before update on public.resume_extractions
  for each row execute function private.set_updated_at();
create trigger candidate_profile_items_set_updated_at before update on public.candidate_profile_items
  for each row execute function private.set_updated_at();
create trigger candidate_profile_items_set_created_by before insert on public.candidate_profile_items
  for each row execute function private.set_actor_column('created_by');
create trigger applications_set_updated_at before update on public.applications
  for each row execute function private.set_updated_at();
create trigger applications_set_created_by before insert on public.applications
  for each row execute function private.set_actor_column('created_by');
create trigger application_events_set_actor before insert on public.application_events
  for each row execute function private.set_actor_column('actor_id');

create trigger candidates_audit after insert or update or delete on public.candidates
  for each row execute function private.audit_row_change();
create trigger resumes_audit after insert or update or delete on public.resumes
  for each row execute function private.audit_row_change();
create trigger resume_extractions_audit after insert or update or delete on public.resume_extractions
  for each row execute function private.audit_row_change();
create trigger candidate_profile_items_audit after insert or update or delete on public.candidate_profile_items
  for each row execute function private.audit_row_change();
create trigger applications_audit after insert or update or delete on public.applications
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
alter table public.candidates enable row level security;
alter table public.resumes enable row level security;
alter table public.resume_extractions enable row level security;
alter table public.candidate_profile_items enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;

create policy candidates_select on public.candidates
  for select to authenticated using (private.can_access_candidate(id));
create policy candidates_insert on public.candidates
  for insert to authenticated with check (private.is_staff());
create policy candidates_update on public.candidates
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy candidates_delete on public.candidates
  for delete to authenticated using (private.is_admin());

create policy resumes_select on public.resumes
  for select to authenticated using (private.can_access_candidate(candidate_id));
create policy resumes_delete on public.resumes
  for delete to authenticated using (private.is_admin());

create policy resume_extractions_select on public.resume_extractions
  for select to authenticated
  using (exists (
    select 1 from public.resumes r
    where r.id = resume_id and private.can_access_candidate(r.candidate_id)
  ));
create policy resume_extractions_update on public.resume_extractions
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

create policy candidate_profile_items_select on public.candidate_profile_items
  for select to authenticated using (private.can_access_candidate(candidate_id));
create policy candidate_profile_items_insert on public.candidate_profile_items
  for insert to authenticated with check (private.is_staff());
create policy candidate_profile_items_update on public.candidate_profile_items
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy candidate_profile_items_delete on public.candidate_profile_items
  for delete to authenticated using (private.is_staff());

create policy applications_select on public.applications
  for select to authenticated using (private.can_access_vacancy(vacancy_id));
create policy applications_insert on public.applications
  for insert to authenticated with check (private.is_staff());
create policy applications_update on public.applications
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

create policy application_events_select on public.application_events
  for select to authenticated using (private.can_access_application(application_id));
-- Inserción directa solo para observaciones; el resto de eventos los generan
-- disparadores y funciones del servidor.
create policy application_events_insert_note on public.application_events
  for insert to authenticated
  with check (
    event_type = 'observacion'
    and actor_id = (select auth.uid())
    and private.can_access_application(application_id)
  );

revoke all on table public.candidates from anon, authenticated;
grant select, delete on table public.candidates to authenticated;
grant insert (
  full_name, email, phone, location, linkedin_url, source, source_detail, field_origins
) on table public.candidates to authenticated;
grant update (
  full_name, email, phone, location, linkedin_url, source, source_detail, field_origins
) on table public.candidates to authenticated;

revoke all on table public.resumes from anon, authenticated;
-- Altas solo mediante register_resume (CV + extracción en una transacción).
grant select, delete on table public.resumes to authenticated;

revoke all on table public.resume_extractions from anon, authenticated;
grant select on table public.resume_extractions to authenticated;
-- RRHH solo puede corregir o transcribir el texto; lo extraído se conserva.
grant update (corrected_text) on table public.resume_extractions to authenticated;

revoke all on table public.candidate_profile_items from anon, authenticated;
grant select, delete on table public.candidate_profile_items to authenticated;
grant insert (
  candidate_id, kind, title, organization, start_date, end_date, description, origin, source_resume_id
) on table public.candidate_profile_items to authenticated;
grant update (
  kind, title, organization, start_date, end_date, description, origin
) on table public.candidate_profile_items to authenticated;

revoke all on table public.applications from anon, authenticated;
-- Sin DELETE: una postulación errónea se marca como retirada para conservar
-- su historial. Solo la eliminación del candidato (derecho de cancelación)
-- borra sus postulaciones.
grant select on table public.applications to authenticated;
grant insert (
  candidate_id, vacancy_id, resume_id, assigned_evaluator_id, applied_at
) on table public.applications to authenticated;
grant update (resume_id, assigned_evaluator_id) on table public.applications to authenticated;

revoke all on table public.application_events from anon, authenticated;
grant select on table public.application_events to authenticated;
grant insert (application_id, event_type, note) on table public.application_events to authenticated;
