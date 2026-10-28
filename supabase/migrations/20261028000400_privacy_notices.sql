-- =============================================================================
-- 2.1 · Aviso de privacidad versionado y constancias de consentimiento
--
-- * privacy_notices: versiones del aviso. Solo administración las gestiona; el
--   título y el texto se editan únicamente mientras son borrador. Una versión se
--   activa con activate_privacy_notice (exige la referencia de aprobación del
--   área legal) y la vigente retira a la anterior en la misma transacción.
-- * consent_records: constancias de consentimiento. Nadie escribe directamente:
--   se crean con private.record_consent (que exige un aviso vigente) y se
--   revocan con revoke_consent. Sin IP ni user agent.
-- * current_privacy_notice: el aviso vigente para la página pública (solo
--   service_role).
-- =============================================================================

create type public.privacy_notice_status as enum ('borrador', 'vigente', 'retirado');
create type public.consent_purpose as enum ('proceso_seleccion', 'cartera_talento');
create type public.consent_method as enum ('formulario_en_linea', 'registro_manual', 'carga_masiva');

-- -----------------------------------------------------------------------------
-- 1. privacy_notices
-- -----------------------------------------------------------------------------
create table public.privacy_notices (
  id uuid primary key default gen_random_uuid(),
  -- Valor provisional: el disparador asigna la versión correlativa real.
  version integer not null default 0 check (version >= 0),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  status public.privacy_notice_status not null default 'borrador',
  approval_reference text check (char_length(approval_reference) <= 500),
  effective_from timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_notices_version_key unique (version),
  constraint privacy_notices_approval_check
    check (status = 'borrador' or (coalesce(char_length(btrim(approval_reference)), 0) >= 1 and effective_from is not null))
);

-- Una sola versión vigente.
create unique index privacy_notices_single_current_idx
  on public.privacy_notices ((true)) where status = 'vigente';

-- Versión correlativa: la asigna el servidor, nunca el cliente.
create function private.assign_privacy_notice_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.privacy_notices.version'));
  new.version := coalesce((select max(version) from public.privacy_notices), 0) + 1;
  return new;
end
$$;

-- El texto solo cambia en borrador; una versión vigente o retirada es evidencia.
-- Transiciones permitidas: borrador -> vigente -> retirado.
create function private.guard_privacy_notice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'borrador' then
      raise exception 'Solo se puede eliminar un borrador del aviso de privacidad' using errcode = 'RH409';
    end if;
    return old;
  end if;

  if new.version is distinct from old.version then
    raise exception 'La versión del aviso no se puede modificar' using errcode = 'RH409';
  end if;

  if old.status = 'borrador' then
    if new.status not in ('borrador', 'vigente') then
      raise exception 'Un borrador solo puede activarse' using errcode = 'RH409';
    end if;
    return new;
  end if;

  if new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.approval_reference is distinct from old.approval_reference
    or new.effective_from is distinct from old.effective_from
    or new.approved_by is distinct from old.approved_by
    or new.created_by is distinct from old.created_by then
    raise exception 'Un aviso vigente o retirado no se puede modificar' using errcode = 'RH409';
  end if;
  if new.status is distinct from old.status
    and not (old.status = 'vigente' and new.status = 'retirado') then
    raise exception 'Transición de estado no permitida' using errcode = 'RH409';
  end if;
  return new;
end
$$;

create trigger privacy_notices_assign_version before insert on public.privacy_notices
  for each row execute function private.assign_privacy_notice_version();
create trigger privacy_notices_guard before update or delete on public.privacy_notices
  for each row execute function private.guard_privacy_notice();
create trigger privacy_notices_set_updated_at before update on public.privacy_notices
  for each row execute function private.set_updated_at();
create trigger privacy_notices_set_created_by before insert on public.privacy_notices
  for each row execute function private.set_actor_column('created_by');
create trigger privacy_notices_audit after insert or update or delete on public.privacy_notices
  for each row execute function private.audit_row_change();

alter table public.privacy_notices enable row level security;

create policy privacy_notices_select on public.privacy_notices
  for select to authenticated using (private.is_staff());
create policy privacy_notices_insert on public.privacy_notices
  for insert to authenticated with check (private.is_admin() and status = 'borrador');
create policy privacy_notices_update on public.privacy_notices
  for update to authenticated
  using (private.is_admin() and status = 'borrador')
  with check (private.is_admin() and status = 'borrador');
create policy privacy_notices_delete on public.privacy_notices
  for delete to authenticated using (private.is_admin() and status = 'borrador');

revoke all on table public.privacy_notices from anon, authenticated;
grant select on table public.privacy_notices to authenticated;
grant insert (title, body) on table public.privacy_notices to authenticated;
grant update (title, body) on table public.privacy_notices to authenticated;
grant delete on table public.privacy_notices to authenticated;

-- Activa un borrador: retira la vigente y fija la fecha y quién lo aprobó.
-- Errores: RH404 no existe, RH409 no es borrador, RH422 sin referencia.
create function public.activate_privacy_notice(p_id uuid, p_approval_reference text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text := btrim(coalesce(p_approval_reference, ''));
  v_notice public.privacy_notices;
begin
  if not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if char_length(v_reference) = 0 then
    raise exception 'Indique la referencia de aprobación del área legal.' using errcode = 'RH422';
  end if;
  if char_length(v_reference) > 500 then
    raise exception 'La referencia de aprobación no puede superar 500 caracteres.' using errcode = 'RH422';
  end if;

  select * into v_notice from public.privacy_notices where id = p_id for update;
  if not found then
    raise exception 'El aviso no existe.' using errcode = 'RH404';
  end if;
  if v_notice.status <> 'borrador' then
    raise exception 'Solo se puede activar un borrador.' using errcode = 'RH409';
  end if;

  -- Primero se retira la vigente: el índice parcial admite una sola.
  update public.privacy_notices set status = 'retirado' where status = 'vigente';

  update public.privacy_notices
     set status = 'vigente',
         approval_reference = v_reference,
         effective_from = now(),
         approved_by = (select auth.uid())
   where id = p_id;

  return v_notice.version;
end
$$;

revoke all on function public.activate_privacy_notice(uuid, text) from public, anon;
grant execute on function public.activate_privacy_notice(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. consent_records
-- Sin IP ni user agent. `recorded_by` es nulo cuando lo registró el propio
-- postulante. La eliminación del candidato borra sus constancias (en cascada)
-- hasta que el área legal decida otra cosa.
-- -----------------------------------------------------------------------------
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  notice_id uuid not null references public.privacy_notices (id) on delete restrict,
  purpose public.consent_purpose not null,
  granted boolean not null,
  method public.consent_method not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  constraint consent_records_revoked_check check (revoked_at is null or granted)
);

create index consent_records_candidate_idx on public.consent_records (candidate_id, created_at desc);
create index consent_records_notice_idx on public.consent_records (notice_id);

create trigger consent_records_audit after insert or update or delete on public.consent_records
  for each row execute function private.audit_row_change();

alter table public.consent_records enable row level security;

create policy consent_records_select on public.consent_records
  for select to authenticated using (private.is_staff());

-- Ningún usuario escribe directamente: solo las funciones de abajo.
revoke all on table public.consent_records from anon, authenticated;
grant select on table public.consent_records to authenticated;

-- Núcleo de escritura. Lo llama el código del servidor mediante funciones que
-- validan a su llamador; verifica que el aviso esté vigente.
-- Errores: RH404 aviso inexistente, RH409 aviso no vigente, RH422 postulación ajena.
create function private.record_consent(
  p_candidate_id uuid,
  p_application_id uuid,
  p_notice_id uuid,
  p_purpose public.consent_purpose,
  p_granted boolean,
  p_method public.consent_method,
  p_recorded_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.privacy_notice_status;
  v_id uuid;
begin
  select status into v_status from public.privacy_notices where id = p_notice_id;
  if not found then
    raise exception 'El aviso de privacidad no existe.' using errcode = 'RH404';
  end if;
  if v_status <> 'vigente' then
    raise exception 'El aviso de privacidad no está vigente.' using errcode = 'RH409';
  end if;
  if p_application_id is not null and not exists (
    select 1 from public.applications where id = p_application_id and candidate_id = p_candidate_id
  ) then
    raise exception 'La postulación no pertenece al candidato.' using errcode = 'RH422';
  end if;

  insert into public.consent_records
    (candidate_id, application_id, notice_id, purpose, granted, method, recorded_by)
  values
    (p_candidate_id, p_application_id, p_notice_id, p_purpose, p_granted, p_method, p_recorded_by)
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function private.record_consent(
  uuid, uuid, uuid, public.consent_purpose, boolean, public.consent_method, uuid
) from public, anon, authenticated;

-- Registra la revocación de la cartera de talento (personal). No borra la fila.
-- Errores: RH404, RH409 (ya revocada o no otorgada), RH422 (otra finalidad).
create function public.revoke_consent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.consent_records;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_record from public.consent_records where id = p_id for update;
  if not found then
    raise exception 'La constancia no existe.' using errcode = 'RH404';
  end if;
  if v_record.purpose <> 'cartera_talento' then
    raise exception 'Solo se puede registrar la revocación de la cartera de talento.' using errcode = 'RH422';
  end if;
  if not v_record.granted then
    raise exception 'La constancia no corresponde a un consentimiento otorgado.' using errcode = 'RH409';
  end if;
  if v_record.revoked_at is not null then
    raise exception 'La constancia ya fue revocada.' using errcode = 'RH409';
  end if;

  update public.consent_records
     set revoked_at = now(), revoked_by = (select auth.uid())
   where id = p_id;
end
$$;

revoke all on function public.revoke_consent(uuid) from public, anon;
grant execute on function public.revoke_consent(uuid) to authenticated;

-- Aviso vigente para la página pública. Solo service_role.
create function public.current_privacy_notice()
returns table (id uuid, version integer, title text, body text, effective_from timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.version, n.title, n.body, n.effective_from
    from public.privacy_notices n
   where n.status = 'vigente'
$$;

revoke all on function public.current_privacy_notice() from public, anon, authenticated;
grant execute on function public.current_privacy_notice() to service_role;
