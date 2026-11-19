-- =============================================================================
-- Incidentes de seguridad (docs/politica-incidentes.md)
--
-- * security_incidents: el registro de cada incidente (también los simulacros,
--   con is_drill). Solo administración.
-- * security_incident_events: la bitácora (acciones, notificaciones y notas).
--   Solo se inserta: no hay UPDATE ni DELETE para nadie, como la auditoría.
-- * security_settings: una sola fila con el oficial de datos personales.
--
-- Todo es solo para administración (private.is_admin()), con auditoría.
-- =============================================================================

create type public.incident_severity as enum ('alta', 'media', 'baja');
create type public.incident_status as enum ('abierto', 'contenido', 'cerrado');
create type public.incident_event_kind as enum ('accion', 'notificacion', 'nota');

create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  -- Cuándo se tomó conocimiento: desde aquí corre el plazo de 48 h.
  detected_at timestamptz not null default now(),
  detected_by_text text not null default '' check (char_length(detected_by_text) <= 200),
  severity public.incident_severity not null,
  description text not null default '' check (char_length(description) <= 5000),
  affected_data text not null default '' check (char_length(affected_data) <= 2000),
  affected_people integer check (affected_people is null or affected_people between 0 and 10000000),
  sensitive_data boolean not null default false,
  status public.incident_status not null default 'abierto',
  is_drill boolean not null default false,
  cause text check (cause is null or char_length(cause) between 1 and 5000),
  prevention text check (prevention is null or char_length(prevention) between 1 and 5000),
  closed_at timestamptz,
  review_done_at timestamptz,
  review_notes text check (review_notes is null or char_length(review_notes) between 1 and 5000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint security_incidents_closed_check check (
    status <> 'cerrado' or (closed_at is not null and cause is not null and prevention is not null)
  ),
  constraint security_incidents_review_check check (review_done_at is null or status = 'cerrado')
);

create index security_incidents_status_idx on public.security_incidents (status, detected_at desc);

create table public.security_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.security_incidents (id) on delete restrict,
  kind public.incident_event_kind not null,
  description text not null check (char_length(description) between 1 and 2000),
  -- Solo en las notificaciones: a quién se avisó (texto libre).
  recipient text check (recipient is null or char_length(recipient) between 1 and 200),
  -- Puede ser anterior a la creación del registro: se anotan acciones ya hechas.
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint security_incident_events_recipient_kind_check check ((kind = 'notificacion') = (recipient is not null))
);

create index security_incident_events_incident_idx on public.security_incident_events (incident_id, occurred_at);

create table public.security_settings (
  -- Una única fila: la clave es siempre true.
  id boolean primary key default true check (id),
  officer_name text check (officer_name is null or char_length(officer_name) between 1 and 200),
  officer_email text check (
    officer_email is null
    or (char_length(officer_email) <= 254 and officer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  designated_at timestamptz,
  designated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint security_settings_officer_pair_check check ((officer_name is null) = (officer_email is null))
);

insert into public.security_settings (id) values (true);

-- -----------------------------------------------------------------------------
-- Reglas de negocio
-- -----------------------------------------------------------------------------

-- Ciclo abierto → contenido → cerrado. Un incidente cerrado no se reabre ni se
-- edita (salvo la revisión); al cerrarlo se piden causa y prevención.
create function private.guard_security_incident()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cerrado' then
    if new.status <> 'cerrado' then
      raise exception 'Un incidente cerrado no se puede reabrir' using errcode = 'RH409';
    end if;
    if (to_jsonb(new) - 'review_done_at' - 'review_notes' - 'updated_at')
       is distinct from (to_jsonb(old) - 'review_done_at' - 'review_notes' - 'updated_at') then
      raise exception 'Un incidente cerrado solo admite el registro de la revisión' using errcode = 'RH409';
    end if;
    if old.review_done_at is not null
       and (new.review_done_at is distinct from old.review_done_at or new.review_notes is distinct from old.review_notes) then
      raise exception 'La revisión ya está registrada' using errcode = 'RH409';
    end if;
    return new;
  end if;

  if new.status = 'cerrado' then
    if nullif(btrim(coalesce(new.cause, '')), '') is null or nullif(btrim(coalesce(new.prevention, '')), '') is null then
      raise exception 'Para cerrar el incidente indique la causa y qué se cambió para que no se repita' using errcode = 'RH422';
    end if;
    new.closed_at := now();
  elsif old.status = 'contenido' and new.status = 'abierto' then
    raise exception 'Un incidente contenido no vuelve a abierto' using errcode = 'RH409';
  end if;

  if new.review_done_at is not null and new.status <> 'cerrado' then
    raise exception 'La revisión se registra con el incidente cerrado' using errcode = 'RH422';
  end if;
  return new;
end
$$;

-- La designación del oficial queda con su fecha y quién la hizo.
create function private.touch_security_officer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.officer_name is distinct from old.officer_name or new.officer_email is distinct from old.officer_email then
    new.designated_at := case when new.officer_name is null then null else now() end;
  end if;
  return new;
end
$$;

-- La bitácora es inmutable: tampoco el dueño de la tabla modifica ni borra eventos.
create function private.prevent_incident_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La bitácora de incidentes no se puede modificar ni borrar' using errcode = '42501';
end
$$;

create trigger security_incidents_guard before update on public.security_incidents
  for each row execute function private.guard_security_incident();
create trigger security_incidents_set_updated_at before update on public.security_incidents
  for each row execute function private.set_updated_at();
create trigger security_incidents_set_created_by before insert on public.security_incidents
  for each row execute function private.set_actor_column('created_by');
create trigger security_incidents_audit after insert or update on public.security_incidents
  for each row execute function private.audit_row_change();

create trigger security_incident_events_immutable before update or delete on public.security_incident_events
  for each row execute function private.prevent_incident_event_change();
create trigger security_incident_events_set_created_by before insert on public.security_incident_events
  for each row execute function private.set_actor_column('created_by');
create trigger security_incident_events_audit after insert on public.security_incident_events
  for each row execute function private.audit_row_change();

create trigger security_settings_officer before update on public.security_settings
  for each row execute function private.touch_security_officer();
create trigger security_settings_set_updated_at before update on public.security_settings
  for each row execute function private.set_updated_at();
create trigger security_settings_set_designated_by before update on public.security_settings
  for each row execute function private.set_actor_column('designated_by');
create trigger security_settings_audit after update on public.security_settings
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS y privilegios: solo administración
-- -----------------------------------------------------------------------------
alter table public.security_incidents enable row level security;
alter table public.security_incident_events enable row level security;
alter table public.security_settings enable row level security;

create policy security_incidents_select on public.security_incidents
  for select to authenticated using (private.is_admin());
create policy security_incidents_insert on public.security_incidents
  for insert to authenticated with check (private.is_admin());
create policy security_incidents_update on public.security_incidents
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- Eventos: solo lectura e inserción (sin políticas de UPDATE ni DELETE).
create policy security_incident_events_select on public.security_incident_events
  for select to authenticated using (private.is_admin());
create policy security_incident_events_insert on public.security_incident_events
  for insert to authenticated with check (private.is_admin());

create policy security_settings_select on public.security_settings
  for select to authenticated using (private.is_admin());
create policy security_settings_update on public.security_settings
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

revoke all on table public.security_incidents from anon, authenticated;
revoke all on table public.security_incident_events from anon, authenticated;
revoke all on table public.security_settings from anon, authenticated;

grant select on table public.security_incidents to authenticated;
grant insert (title, detected_at, detected_by_text, severity, description, affected_data, affected_people, sensitive_data, is_drill)
  on table public.security_incidents to authenticated;
grant update (title, detected_at, detected_by_text, severity, description, affected_data, affected_people, sensitive_data,
              status, cause, prevention, review_done_at, review_notes)
  on table public.security_incidents to authenticated;

grant select on table public.security_incident_events to authenticated;
grant insert (incident_id, kind, description, recipient, occurred_at) on table public.security_incident_events to authenticated;

grant select on table public.security_settings to authenticated;
grant update (officer_name, officer_email) on table public.security_settings to authenticated;
