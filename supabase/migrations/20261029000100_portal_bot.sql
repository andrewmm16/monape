-- =============================================================================
-- Robot de portales (piloto: Trabajos Diarios)
--
-- Un servicio externo (bot) publica las vacantes en portales cerrados y trae de
-- vuelta a los postulantes. La base de datos aporta:
--
-- * job_portals.bot_enabled: portales que el bot sabe atender.
-- * portal_publications: cola y estado de la publicación de una vacante en un
--   portal (una fila por vacante y portal). Solo se modifica con las funciones
--   de abajo: RRHH solicita (request_*) y el bot, con service_role, reclama y
--   reporta (bot_*).
-- * Al cerrar o archivar una vacante, sus publicaciones pasan a retiro.
-- * register_bot_application: registro atómico y sin duplicados (por oferta e
--   id externo) de un postulante traído por el bot.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo
-- -----------------------------------------------------------------------------
alter table public.job_portals add column bot_enabled boolean not null default false;
update public.job_portals set bot_enabled = true where name = 'Trabajos Diarios';

-- -----------------------------------------------------------------------------
-- 2. Publicaciones por portal
-- -----------------------------------------------------------------------------
create type public.portal_publication_status as enum (
  'pendiente', 'publicando', 'publicada', 'retirar', 'retirada', 'error'
);

create table public.portal_publications (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete restrict,
  portal_id uuid not null references public.job_portals (id) on delete restrict,
  status public.portal_publication_status not null default 'pendiente',
  -- Identificador y enlace de la oferta en el portal, informados por el bot.
  external_id text check (char_length(external_id) between 1 and 200),
  external_url text check (char_length(external_url) <= 500 and external_url ~ '^https://'),
  -- Código corto del último fallo; nunca datos personales ni texto libre.
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  published_at timestamptz,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint portal_publications_vacancy_portal_key unique (vacancy_id, portal_id),
  constraint portal_publications_published_check
    check (status not in ('publicada', 'retirar') or external_id is not null)
);

create index portal_publications_queue_idx
  on public.portal_publications (portal_id, status)
  where status in ('pendiente', 'publicando', 'retirar');

alter table public.portal_publications enable row level security;

create policy portal_publications_select on public.portal_publications
  for select to authenticated using (private.is_staff());

revoke all on table public.portal_publications from anon, authenticated;
grant select on table public.portal_publications to authenticated;

-- -----------------------------------------------------------------------------
-- 3. RRHH: solicitar y retirar
-- Errores: RH404 vacante o portal inexistente, RH409 estado que no lo permite.
-- -----------------------------------------------------------------------------
create function public.request_portal_publication(p_vacancy_id uuid, p_portal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.vacancies%rowtype;
  v_portal public.job_portals%rowtype;
  v_existing public.portal_publications%rowtype;
  v_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_vacancy from public.vacancies where id = p_vacancy_id;
  if not found then
    raise exception 'La vacante no existe' using errcode = 'RH404';
  end if;
  if v_vacancy.status <> 'publicada' then
    raise exception 'Solo se publican vacantes en estado publicada' using errcode = 'RH409';
  end if;

  select * into v_portal from public.job_portals where id = p_portal_id and is_active and bot_enabled;
  if not found then
    raise exception 'El portal no existe o no admite publicación automática' using errcode = 'RH404';
  end if;

  select * into v_existing
  from public.portal_publications
  where vacancy_id = p_vacancy_id and portal_id = p_portal_id
  for update;

  if found then
    if v_existing.status not in ('error', 'retirada') then
      raise exception 'La vacante ya está solicitada en este portal' using errcode = 'RH409';
    end if;
    -- Una oferta retirada en el portal puede volver a publicarse; la anterior queda olvidada.
    update public.portal_publications
    set status = 'pendiente', external_id = null, external_url = null, error_code = null,
        attempts = 0, claimed_at = null, published_at = null,
        requested_by = (select auth.uid()), requested_at = now(), updated_at = now()
    where id = v_existing.id;
    v_id := v_existing.id;
  else
    insert into public.portal_publications (vacancy_id, portal_id, requested_by)
    values (p_vacancy_id, p_portal_id, (select auth.uid()))
    returning id into v_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'publicacion_portal_solicitada', 'portal_publications', v_id::text,
    jsonb_build_object('vacancy_id', p_vacancy_id, 'portal', v_portal.name));
  return v_id;
end
$$;

create function public.request_portal_withdrawal(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.portal_publications%rowtype;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_pub from public.portal_publications where id = p_publication_id for update;
  if not found then
    raise exception 'La publicación no existe' using errcode = 'RH404';
  end if;

  if v_pub.status = 'publicada' then
    update public.portal_publications
    set status = 'retirar', claimed_at = null, attempts = 0, error_code = null, updated_at = now()
    where id = v_pub.id;
  elsif v_pub.status = 'pendiente' then
    -- Aún no salió: se cancela sin tocar el portal.
    update public.portal_publications set status = 'retirada', updated_at = now() where id = v_pub.id;
  else
    raise exception 'La publicación no se puede retirar en este estado' using errcode = 'RH409';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'publicacion_portal_retiro', 'portal_publications', v_pub.id::text,
    jsonb_build_object('vacancy_id', v_pub.vacancy_id));
end
$$;

revoke all on function public.request_portal_publication(uuid, uuid) from public, anon;
grant execute on function public.request_portal_publication(uuid, uuid) to authenticated;
revoke all on function public.request_portal_withdrawal(uuid) from public, anon;
grant execute on function public.request_portal_withdrawal(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Una vacante cerrada o archivada se retira de los portales
-- -----------------------------------------------------------------------------
create function private.retire_portal_publications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cerrada', 'archivada') and old.status is distinct from new.status then
    update public.portal_publications
    set status = case when status = 'pendiente' then 'retirada'::public.portal_publication_status
                      else 'retirar'::public.portal_publication_status end,
        claimed_at = null, attempts = 0, updated_at = now()
    where vacancy_id = new.id and status in ('pendiente', 'publicando', 'publicada');
  end if;
  return null;
end
$$;

revoke all on function private.retire_portal_publications() from public, anon, authenticated;

create trigger vacancies_retire_portal_publications
  after update of status on public.vacancies
  for each row execute function private.retire_portal_publications();

-- -----------------------------------------------------------------------------
-- 5. Bot (solo service_role)
-- bot_claim_publication entrega el siguiente trabajo del portal y lo reserva 30
-- minutos (si el bot se cae, otro intento lo retoma). Máximo 3 intentos.
-- -----------------------------------------------------------------------------
create function public.bot_claim_publication(p_portal_id uuid)
returns table (publication_id uuid, action text, external_id text, vacancy jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.portal_publications%rowtype;
  v_vacancy public.vacancies%rowtype;
begin
  select p.* into v_pub
  from public.portal_publications p
  where p.portal_id = p_portal_id
    and p.status in ('pendiente', 'publicando', 'retirar')
    and (p.claimed_at is null or p.claimed_at < now() - interval '30 minutes')
  order by p.requested_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;

  if v_pub.attempts >= 3 then
    update public.portal_publications
    set status = 'error', error_code = 'demasiados_intentos', claimed_at = null, updated_at = now()
    where id = v_pub.id;
    return;
  end if;

  update public.portal_publications
  set claimed_at = now(), attempts = attempts + 1,
      status = case when status = 'retirar' then status else 'publicando'::public.portal_publication_status end,
      updated_at = now()
  where id = v_pub.id;

  select * into v_vacancy from public.vacancies where id = v_pub.vacancy_id;

  return query select
    v_pub.id,
    case when v_pub.status = 'retirar' then 'retirar' else 'publicar' end,
    v_pub.external_id,
    jsonb_build_object(
      'id', v_vacancy.id,
      'title', v_vacancy.title,
      'department', v_vacancy.department,
      'description', v_vacancy.description,
      'responsibilities', v_vacancy.responsibilities,
      'location', v_vacancy.location,
      'city', v_vacancy.city,
      'region', v_vacancy.region,
      'modality', v_vacancy.modality,
      'contract_type', v_vacancy.contract_type,
      'closing_date', v_vacancy.closing_date,
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object('description', r.description, 'priority', r.priority)
                         order by r.position, r.created_at)
        from public.vacancy_requirements r where r.vacancy_id = v_vacancy.id
      ), '[]'::jsonb)
    );
end
$$;

-- Resultado de un trabajo: 'publicada' (con id y enlace), 'retirada' o 'error'.
create function public.bot_report_publication(
  p_publication_id uuid,
  p_outcome text,
  p_external_id text,
  p_external_url text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.portal_publications%rowtype;
begin
  select * into v_pub from public.portal_publications where id = p_publication_id for update;
  if not found then
    raise exception 'La publicación no existe' using errcode = 'RH404';
  end if;

  if p_outcome = 'publicada' then
    if v_pub.status <> 'publicando' then
      raise exception 'La publicación no está en curso' using errcode = 'RH409';
    end if;
    update public.portal_publications
    set status = 'publicada', external_id = p_external_id, external_url = p_external_url,
        error_code = null, claimed_at = null, published_at = now(), updated_at = now()
    where id = v_pub.id;
  elsif p_outcome = 'retirada' then
    if v_pub.status <> 'retirar' then
      raise exception 'La publicación no está en retiro' using errcode = 'RH409';
    end if;
    update public.portal_publications
    set status = 'retirada', error_code = null, claimed_at = null, updated_at = now()
    where id = v_pub.id;
  elsif p_outcome = 'error' then
    if v_pub.status not in ('publicando', 'retirar') then
      raise exception 'La publicación no está en curso' using errcode = 'RH409';
    end if;
    -- Un fallo al publicar queda visible para RRHH; uno al retirar se reintenta.
    update public.portal_publications
    set status = case when status = 'publicando' then 'error'::public.portal_publication_status else status end,
        error_code = p_error_code, claimed_at = null, updated_at = now()
    where id = v_pub.id;
  else
    raise exception 'Resultado no válido' using errcode = 'RH422';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'publicacion_portal_' || p_outcome, 'portal_publications', v_pub.id::text,
    jsonb_build_object('vacancy_id', v_pub.vacancy_id, 'portal_id', v_pub.portal_id, 'error_code', p_error_code));
end
$$;

-- Ofertas activas de un portal, para que el bot revise sus postulantes.
create function public.bot_list_active_publications(p_portal_id uuid)
returns table (publication_id uuid, external_id text, external_url text, last_synced_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.external_id, p.external_url, p.last_synced_at
  from public.portal_publications p
  where p.portal_id = p_portal_id and p.status in ('publicada', 'retirar')
  order by p.last_synced_at nulls first
$$;

create function public.bot_mark_synced(p_publication_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.portal_publications set last_synced_at = now() where id = p_publication_id
$$;

-- -----------------------------------------------------------------------------
-- 6. Postulantes traídos por el bot
-- -----------------------------------------------------------------------------
alter table public.integration_submissions drop constraint integration_submissions_provider_check;
alter table public.integration_submissions
  add constraint integration_submissions_provider_check check (provider in ('talent_apply', 'portal_bot'));

-- Mismo contrato que register_integration_application, pero la vacante y el
-- portal salen de la publicación y el id externo es único por oferta. Siempre
-- crea un candidato NUEVO. Errores: RH404 publicación inexistente o sin portal,
-- RH409 vacante que ya no recibe postulaciones.
create function public.register_bot_application(
  p_publication_id uuid,
  p_external_id text,
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
  c_provider constant text := 'portal_bot';
  v_pub public.portal_publications%rowtype;
  v_vacancy public.vacancies%rowtype;
  v_portal public.job_portals%rowtype;
  v_key text;
  v_existing public.integration_submissions%rowtype;
  v_email_norm text;
  v_phone_norm text;
  v_duplicates text[];
  v_application_id uuid;
  v_origins jsonb;
begin
  if p_external_id is null or char_length(p_external_id) not between 1 and 150 then
    raise exception 'Identificador externo no válido' using errcode = 'RH422';
  end if;

  select * into v_pub from public.portal_publications where id = p_publication_id;
  if not found or v_pub.status not in ('publicada', 'retirar', 'retirada') then
    raise exception 'La publicación no existe' using errcode = 'RH404';
  end if;
  select * into v_portal from public.job_portals where id = v_pub.portal_id;

  -- El id externo es único por oferta: la misma persona en dos ofertas son dos postulaciones.
  v_key := v_pub.id::text || ':' || p_external_id;
  perform pg_advisory_xact_lock(hashtextextended('integration:' || c_provider || ':' || v_key, 0));

  select * into v_existing
  from public.integration_submissions s
  where s.provider = c_provider and s.external_id = v_key;
  if found and v_existing.status = 'registrada' then
    return query select v_existing.application_id, true;
    return;
  end if;

  select * into v_vacancy from public.vacancies v where v.id = v_pub.vacancy_id for share;
  if v_vacancy.status not in ('publicada', 'cerrada') then
    raise exception 'La vacante ya no recibe postulaciones' using errcode = 'RH409';
  end if;

  v_origins := jsonb_build_object('full_name', 'declarado');
  if nullif(btrim(p_email), '') is not null then
    v_origins := v_origins || jsonb_build_object('email', 'declarado');
  end if;
  if nullif(btrim(p_phone), '') is not null then
    v_origins := v_origins || jsonb_build_object('phone', 'declarado');
  end if;
  insert into public.candidates (id, full_name, email, phone, source, source_detail, field_origins)
  values (
    p_candidate_id, btrim(p_full_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''),
    v_portal.candidate_source, v_portal.name, v_origins
  )
  returning email_normalized, phone_normalized into v_email_norm, v_phone_norm;

  v_duplicates := private.duplicate_reasons(v_email_norm, v_phone_norm, p_sha256, p_candidate_id);

  perform private.register_resume_core(
    p_resume_id, p_candidate_id, p_storage_path, p_original_filename, p_mime_type,
    p_size_bytes, p_sha256, p_extraction_status, p_extraction_method, p_extractor_version,
    p_raw_text, p_suggested_fields, p_warnings, p_error_code
  );

  insert into public.applications (
    candidate_id, vacancy_id, resume_id, portal_id, intake_method, possible_duplicate_reasons
  )
  values (p_candidate_id, v_vacancy.id, p_resume_id, v_portal.id, 'integracion', v_duplicates)
  returning id into v_application_id;

  if v_existing.id is not null then
    update public.integration_submissions
    set vacancy_id = v_vacancy.id, candidate_id = p_candidate_id, application_id = v_application_id,
        status = 'registrada', reason = null, duplicate_reasons = v_duplicates, received_at = now()
    where id = v_existing.id;
  else
    insert into public.integration_submissions (
      provider, external_id, vacancy_id, candidate_id, application_id, status, duplicate_reasons
    )
    values (c_provider, v_key, v_vacancy.id, p_candidate_id, v_application_id, 'registrada', v_duplicates);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'integracion_postulacion', 'applications', v_application_id::text,
    jsonb_build_object(
      'provider', c_provider,
      'intake_method', 'integracion',
      'portal_id', v_portal.id,
      'portal', v_portal.name,
      'publication_id', v_pub.id,
      'duplicate_reasons', to_jsonb(v_duplicates)
    ));

  return query select v_application_id, false;
end
$$;

revoke all on function public.bot_claim_publication(uuid) from public, anon, authenticated;
grant execute on function public.bot_claim_publication(uuid) to service_role;
revoke all on function public.bot_report_publication(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bot_report_publication(uuid, text, text, text, text) to service_role;
revoke all on function public.bot_list_active_publications(uuid) from public, anon, authenticated;
grant execute on function public.bot_list_active_publications(uuid) to service_role;
revoke all on function public.bot_mark_synced(uuid) from public, anon, authenticated;
grant execute on function public.bot_mark_synced(uuid) to service_role;
revoke all on function public.register_bot_application(
  uuid, text, uuid, uuid, text, text, text, text, text, text, integer, text,
  public.extraction_status, text, text, text, jsonb, text[], text
) from public, anon, authenticated;
grant execute on function public.register_bot_application(
  uuid, text, uuid, uuid, text, text, text, text, text, text, integer, text,
  public.extraction_status, text, text, text, jsonb, text[], text
) to service_role;
