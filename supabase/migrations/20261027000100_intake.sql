-- =============================================================================
-- 0011 · Portales de empleo, carga masiva de CV y bandeja de entrada
--
-- * job_portals: catálogo de portales, compartido por todas las vías de ingreso.
-- * applications.portal_id / intake_method: origen de cada postulación. Solo
--   las fija la función de registro (ningún usuario las escribe directamente).
-- * intake_batches / intake_batch_items: lote de CV por vacante y portal, con
--   su revisión previa al registro.
-- * register_batch_item: registro atómico de un ítem (candidato, CV, extracción
--   y postulación). batch_item_duplicates: posibles duplicados de un lote.
-- * consume_rate_limit: nuevo tipo cv_bulk_upload (100 cada 10 minutos).
--
-- Los archivos del lote esperan en intake/{lote}/{ítem}.{ext} del bucket
-- privado `resumes` (sin políticas para usuarios, ver 0005); el servidor los
-- mueve a candidates/{candidato}/… al registrar.
-- =============================================================================

create type public.job_portal_kind as enum ('automatico', 'manual');
create type public.application_intake_method as enum (
  'manual', 'carga_masiva', 'formulario_en_linea', 'integracion'
);
create type public.intake_batch_status as enum ('abierto', 'cerrado');
create type public.intake_item_status as enum ('listo', 'requiere_datos', 'error', 'registrado');

-- -----------------------------------------------------------------------------
-- Catálogo de portales
-- -----------------------------------------------------------------------------
create table public.job_portals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  kind public.job_portal_kind not null,
  -- Valor de candidates.source que corresponde a las personas de este portal.
  candidate_source public.candidate_source not null,
  is_active boolean not null default true,
  position integer not null default 0
);

insert into public.job_portals (name, kind, candidate_source, position) values
  ('Página de empleos', 'automatico', 'web_empresa', 10),
  ('Google', 'automatico', 'bolsa_empleo', 20),
  ('Talent.com', 'automatico', 'bolsa_empleo', 30),
  ('Jooble', 'automatico', 'bolsa_empleo', 40),
  ('Trovit', 'automatico', 'bolsa_empleo', 50),
  ('Careerjet', 'automatico', 'bolsa_empleo', 60),
  ('OpcionEmpleo', 'automatico', 'bolsa_empleo', 70),
  ('JobTome', 'automatico', 'bolsa_empleo', 80),
  ('JobisJob', 'automatico', 'bolsa_empleo', 90),
  ('LinkedIn', 'manual', 'linkedin', 100),
  ('Computrabajo', 'manual', 'bolsa_empleo', 110),
  ('Indeed', 'manual', 'bolsa_empleo', 120),
  ('Bumeran', 'manual', 'bolsa_empleo', 130),
  ('Get on Board', 'manual', 'bolsa_empleo', 140),
  ('Torre', 'manual', 'bolsa_empleo', 150),
  ('Empleos Perú', 'manual', 'bolsa_empleo', 160),
  ('Otro', 'manual', 'otro', 999);

alter table public.job_portals enable row level security;

create policy job_portals_select on public.job_portals
  for select to authenticated using (private.is_staff());
create policy job_portals_insert on public.job_portals
  for insert to authenticated with check (private.is_admin());
create policy job_portals_update on public.job_portals
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy job_portals_delete on public.job_portals
  for delete to authenticated using (private.is_admin());

revoke all on table public.job_portals from anon, authenticated;
grant select, delete on table public.job_portals to authenticated;
grant insert (name, kind, candidate_source, is_active, position) on table public.job_portals to authenticated;
grant update (name, kind, candidate_source, is_active, position) on table public.job_portals to authenticated;

-- -----------------------------------------------------------------------------
-- Origen de la postulación
-- -----------------------------------------------------------------------------
alter table public.applications
  add column portal_id uuid references public.job_portals (id) on delete restrict,
  add column intake_method public.application_intake_method not null default 'manual';

create index applications_portal_idx on public.applications (portal_id);
create index applications_status_applied_idx on public.applications (status, applied_at desc);

-- Las columnas nuevas no se agregan a los privilegios de INSERT/UPDATE de
-- `authenticated` (ver 0003): solo register_batch_item las fija.

-- Se añaden las columnas AL FINAL. vacancy_title ya existía desde 0006; se
-- agregan portal_name, intake_method y portal_id (filtro de la bandeja).
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
  a.portal_id
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
-- Lotes de carga masiva
-- -----------------------------------------------------------------------------
create table public.intake_batches (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete restrict,
  portal_id uuid not null references public.job_portals (id) on delete restrict,
  status public.intake_batch_status not null default 'abierto',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint intake_batches_closed_check check ((status = 'cerrado') = (closed_at is not null))
);

-- Como máximo un lote abierto por vacante y usuario: al volver, se continúa.
create unique index intake_batches_one_open_idx
  on public.intake_batches (vacancy_id, created_by) where status = 'abierto';
create index intake_batches_vacancy_idx on public.intake_batches (vacancy_id);

create table public.intake_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.intake_batches (id) on delete cascade,
  status public.intake_item_status not null,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  -- Ruta temporal; se limpia al registrar (el archivo pasa a candidates/…).
  storage_path text,
  mime_type text check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer check (size_bytes > 0 and size_bytes <= 4194304),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  extraction_status public.extraction_status,
  extraction_method text check (extraction_method in ('pdf_text', 'docx_text')),
  -- Se borra al registrar: el texto queda solo en resume_extractions.
  raw_text text check (char_length(raw_text) <= 200000),
  suggested_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(suggested_fields) = 'object'),
  warnings text[] not null default '{}',
  -- Datos propuestos; RRHH los revisa antes de registrar.
  full_name text check (char_length(full_name) between 2 and 160),
  email text check (
    email is null
    or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  phone text check (char_length(phone) <= 40),
  -- El nombre se aceptó tal como se extrajo del CV.
  name_from_cv boolean not null default false,
  error_code text check (char_length(error_code) <= 64),
  candidate_id uuid references public.candidates (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_batch_items_sha_key unique (batch_id, sha256),
  constraint intake_batch_items_path_check
    check (storage_path is null or storage_path like 'intake/' || batch_id::text || '/%'),
  constraint intake_batch_items_error_check
    check (status <> 'error' or storage_path is null)
);

create index intake_batch_items_batch_idx on public.intake_batch_items (batch_id, created_at);

-- Máximo 50 ítems por lote y estado coherente con el nombre propuesto.
create function private.prepare_intake_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'registrado' then
      raise exception 'Un ítem nuevo no puede estar registrado' using errcode = 'RH422';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('intake:' || new.batch_id::text, 0));
    if (select count(*) from public.intake_batch_items i where i.batch_id = new.batch_id) >= 50 then
      raise exception 'Un lote admite como máximo 50 archivos' using errcode = 'RH422';
    end if;
    if not exists (
      select 1 from public.intake_batches b where b.id = new.batch_id and b.status = 'abierto'
    ) then
      raise exception 'El lote está cerrado' using errcode = 'RH409';
    end if;
  end if;

  new.full_name := nullif(btrim(new.full_name), '');
  new.email := nullif(btrim(new.email), '');
  new.phone := nullif(btrim(new.phone), '');

  if new.status in ('listo', 'requiere_datos') then
    new.status := case when new.full_name is not null then 'listo' else 'requiere_datos' end;
  end if;
  return new;
end
$$;

create trigger intake_batch_items_prepare
  before insert or update on public.intake_batch_items
  for each row execute function private.prepare_intake_item();
create trigger intake_batch_items_set_updated_at before update on public.intake_batch_items
  for each row execute function private.set_updated_at();
create trigger intake_batches_set_created_by before insert on public.intake_batches
  for each row execute function private.set_actor_column('created_by');

alter table public.intake_batches enable row level security;
alter table public.intake_batch_items enable row level security;

create policy intake_batches_select on public.intake_batches
  for select to authenticated using (private.is_staff());
create policy intake_batches_insert on public.intake_batches
  for insert to authenticated with check (private.is_staff());
create policy intake_batches_update on public.intake_batches
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

create policy intake_batch_items_select on public.intake_batch_items
  for select to authenticated using (private.is_staff());
create policy intake_batch_items_insert on public.intake_batch_items
  for insert to authenticated with check (private.is_staff());
-- Solo se editan ítems pendientes de registro.
create policy intake_batch_items_update on public.intake_batch_items
  for update to authenticated
  using (private.is_staff() and status in ('listo', 'requiere_datos'))
  with check (private.is_staff());
create policy intake_batch_items_delete on public.intake_batch_items
  for delete to authenticated using (private.is_staff() and status <> 'registrado');

revoke all on table public.intake_batches from anon, authenticated;
grant select on table public.intake_batches to authenticated;
grant insert (vacancy_id, portal_id) on table public.intake_batches to authenticated;
grant update (status, closed_at) on table public.intake_batches to authenticated;

revoke all on table public.intake_batch_items from anon, authenticated;
grant select, delete on table public.intake_batch_items to authenticated;
-- candidate_id y application_id los fija solo register_batch_item.
grant insert (
  id, batch_id, status, original_filename, storage_path, mime_type, size_bytes, sha256,
  extraction_status, extraction_method, raw_text, suggested_fields, warnings,
  full_name, email, phone, name_from_cv, error_code
) on table public.intake_batch_items to authenticated;
grant update (full_name, email, phone, name_from_cv) on table public.intake_batch_items to authenticated;

-- -----------------------------------------------------------------------------
-- Registro atómico de un ítem. El servidor genera los identificadores del
-- candidato y del CV y mueve el archivo a la ruta definitiva ANTES de llamar;
-- si esta función falla, lo devuelve a su lugar.
-- -----------------------------------------------------------------------------
create function public.register_batch_item(
  p_item_id uuid,
  p_candidate_id uuid,
  p_resume_id uuid,
  p_storage_path text,
  p_extractor_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_batch_items%rowtype;
  v_batch public.intake_batches%rowtype;
  v_portal public.job_portals%rowtype;
  v_origins jsonb := '{}'::jsonb;
  v_suggested_email text;
  v_suggested_phone text;
  v_application_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_item from public.intake_batch_items where id = p_item_id for update;
  if not found then
    raise exception 'Archivo del lote no encontrado' using errcode = 'RH404';
  end if;
  select * into v_batch from public.intake_batches where id = v_item.batch_id for update;
  if v_batch.status <> 'abierto' then
    raise exception 'El lote está cerrado' using errcode = 'RH409';
  end if;
  if v_item.status = 'registrado' then
    raise exception 'El archivo ya fue registrado' using errcode = 'RH409';
  end if;
  if v_item.status = 'error' then
    raise exception 'El archivo tiene un error y no se puede registrar' using errcode = 'RH409';
  end if;
  if v_item.full_name is null then
    raise exception 'Falta el nombre del candidato' using errcode = 'RH422';
  end if;
  if v_item.extraction_status is null or v_item.extraction_method is null
     or v_item.sha256 is null or v_item.mime_type is null or v_item.size_bytes is null then
    raise exception 'El archivo no tiene datos de extracción' using errcode = 'RH422';
  end if;
  if p_storage_path not like 'candidates/' || p_candidate_id::text || '/%' then
    raise exception 'Ruta de archivo no válida' using errcode = 'RH422';
  end if;

  select * into v_portal from public.job_portals where id = v_batch.portal_id;
  if not v_portal.is_active then
    raise exception 'El portal ya no está activo' using errcode = 'RH409';
  end if;

  -- Origen de cada campo: extraído si RRHH aceptó el valor del CV, declarado
  -- si lo escribió.
  v_suggested_email := lower(btrim(v_item.suggested_fields #>> '{email,value}'));
  v_suggested_phone := private.normalize_phone(v_item.suggested_fields #>> '{phone,value}');
  v_origins := jsonb_build_object(
    'full_name', case when v_item.name_from_cv then 'extraido' else 'declarado' end
  );
  if v_item.email is not null then
    v_origins := v_origins || jsonb_build_object(
      'email', case when lower(v_item.email) = v_suggested_email then 'extraido' else 'declarado' end
    );
  end if;
  if v_item.phone is not null then
    v_origins := v_origins || jsonb_build_object(
      'phone', case when private.normalize_phone(v_item.phone) = v_suggested_phone
                    then 'extraido' else 'declarado' end
    );
  end if;

  insert into public.candidates (id, full_name, email, phone, source, source_detail, field_origins)
  values (
    p_candidate_id, v_item.full_name, v_item.email, v_item.phone,
    v_portal.candidate_source, v_portal.name, v_origins
  );

  -- CV + extracción: misma lógica que register_resume.
  perform public.register_resume(
    p_resume_id, p_candidate_id, p_storage_path, v_item.original_filename, v_item.mime_type,
    v_item.size_bytes, v_item.sha256, v_item.extraction_status, v_item.extraction_method,
    p_extractor_version, v_item.raw_text, v_item.suggested_fields, v_item.warnings,
    case when v_item.extraction_status = 'fallida' then v_item.error_code end
  );

  -- El disparador applications_check_vacancy exige una vacante que admita
  -- postulaciones.
  insert into public.applications (candidate_id, vacancy_id, resume_id, portal_id, intake_method)
  values (p_candidate_id, v_batch.vacancy_id, p_resume_id, v_portal.id, 'carga_masiva')
  returning id into v_application_id;

  update public.intake_batch_items
  set status = 'registrado',
      candidate_id = p_candidate_id,
      application_id = v_application_id,
      raw_text = null,
      storage_path = null
  where id = p_item_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'carga_masiva',
    'applications',
    v_application_id::text,
    jsonb_build_object(
      'intake_method', 'carga_masiva',
      'portal_id', v_portal.id,
      'portal', v_portal.name,
      'batch_id', v_batch.id
    )
  );

  return v_application_id;
end
$$;

revoke all on function public.register_batch_item(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.register_batch_item(uuid, uuid, uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Posibles duplicados de los ítems pendientes de un lote: candidatos
-- existentes que coinciden en correo, teléfono o nombre (find_candidate_duplicates)
-- o que ya tienen un CV con el mismo SHA-256.
-- -----------------------------------------------------------------------------
create function public.batch_item_duplicates(p_batch_id uuid)
returns table (
  item_id uuid,
  candidate_id uuid,
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
  select m.item_id, m.candidate_id, m.full_name, m.email, m.phone, m.match_reasons
  from public.intake_batch_items i
  cross join lateral (
    select
      i.id as item_id,
      c.id as candidate_id,
      c.full_name,
      c.email,
      c.phone,
      array_remove(array[
        case when c.email_normalized = nullif(lower(btrim(i.email)), '') then 'correo' end,
        case when c.phone_normalized = private.normalize_phone(i.phone) then 'telefono' end,
        case when c.name_normalized = private.normalize_person_name(i.full_name) then 'nombre' end,
        case when i.sha256 is not null and exists (
          select 1 from public.resumes r where r.candidate_id = c.id and r.sha256 = i.sha256
        ) then 'cv' end
      ], null) as match_reasons
    from public.candidates c
    where c.email_normalized = nullif(lower(btrim(i.email)), '')
       or c.phone_normalized = private.normalize_phone(i.phone)
       or c.name_normalized = private.normalize_person_name(i.full_name)
       or (i.sha256 is not null and exists (
            select 1 from public.resumes r where r.candidate_id = c.id and r.sha256 = i.sha256
          ))
    order by c.created_at desc
    limit 5
  ) m
  where i.batch_id = p_batch_id
    and i.status in ('listo', 'requiere_datos')
$$;

revoke all on function public.batch_item_duplicates(uuid) from public, anon;
grant execute on function public.batch_item_duplicates(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Límite de solicitudes: se agrega cv_bulk_upload (100 cada 10 minutos).
-- Misma definición que en 0001 con un tipo más.
-- -----------------------------------------------------------------------------
create or replace function public.consume_rate_limit(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_window interval;
  v_key text;
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  select l.max_requests, l.window_length
  into v_max, v_window
  from (values
    ('cv_upload', 20, interval '10 minutes'),
    ('cv_download', 60, interval '10 minutes'),
    ('evaluation', 30, interval '10 minutes'),
    ('ai_evaluation', 10, interval '10 minutes'),
    ('user_invite', 10, interval '1 hour'),
    ('cv_bulk_upload', 100, interval '10 minutes')
  ) as l(bucket, max_requests, window_length)
  where l.bucket = p_bucket;

  if v_max is null then
    raise exception 'Tipo de operación desconocido' using errcode = 'RH422';
  end if;

  v_key := (select auth.uid())::text || ':' || p_bucket;

  insert into private.rate_limits as r (key, window_start, request_count)
  values (v_key, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - v_window then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - v_window then v_now
          else r.window_start
        end
  returning request_count into v_count;

  return v_count <= v_max;
end
$$;
