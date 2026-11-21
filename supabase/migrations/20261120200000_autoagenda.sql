-- =============================================================================
-- Autoagenda de entrevistas
-- (docs/superpowers/specs/2026-11-20-talento-y-autoagenda-design.md)
--
-- RRHH ofrece de 1 a 6 horarios; la persona candidata elige uno desde un enlace
-- (token aleatorio; aquí solo se guarda su sha256) y la entrevista se crea sola.
-- Opción A (horarios por invitación), preparada para la B (disponibilidad
-- semanal): los horarios son filas concretas y la elección es la misma; un
-- horario está «tomado» si quien invitó ya tiene otra entrevista programada
-- que se superpone.
--
-- 1. interview_booking_offers / interview_booking_slots (+ RLS de lectura).
-- 2. private.schedule_interview_core: el cuerpo de schedule_interview, sin los
--    controles de personal; schedule_interview queda como envoltorio. Al crear
--    una entrevista se cancela la invitación pendiente de esa postulación.
-- 3. create_interview_booking / cancel_interview_booking (personal).
-- 4. get_interview_booking / book_interview_slot / expire_interview_bookings /
--    enqueue_system_interview_deep_dive (solo service_role).
-- 5. notification_kind: 'agenda_vencida'.
-- =============================================================================

alter type public.notification_kind add value if not exists 'agenda_vencida';

create type public.interview_booking_status as enum ('pendiente', 'agendada', 'vencida', 'cancelada');

create table public.interview_booking_offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  duration_minutes smallint not null check (duration_minutes between 15 and 480),
  modality public.interview_modality not null,
  location text check (char_length(location) <= 500),
  interviewers text check (char_length(interviewers) <= 300),
  interviewer_emails text[] not null default '{}',
  instructions text check (char_length(instructions) <= 2000),
  expires_at timestamptz not null,
  status public.interview_booking_status not null default 'pendiente',
  interview_id uuid references public.interviews (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index interview_booking_offers_one_pending_idx
  on public.interview_booking_offers (application_id)
  where status = 'pendiente';
create index interview_booking_offers_expiry_idx
  on public.interview_booking_offers (expires_at)
  where status = 'pendiente';

create table public.interview_booking_slots (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.interview_booking_offers (id) on delete cascade,
  starts_at timestamptz not null,
  unique (offer_id, starts_at)
);

create trigger interview_booking_offers_audit after insert or update or delete on public.interview_booking_offers
  for each row execute function private.audit_row_change();

alter table public.interview_booking_offers enable row level security;
alter table public.interview_booking_slots enable row level security;

create policy interview_booking_offers_select on public.interview_booking_offers
  for select to authenticated
  using (private.is_staff() and private.can_access_application(application_id));
create policy interview_booking_slots_select on public.interview_booking_slots
  for select to authenticated
  using (exists (
    select 1 from public.interview_booking_offers o
    where o.id = offer_id and private.is_staff() and private.can_access_application(o.application_id)
  ));

revoke all on table public.interview_booking_offers from anon, authenticated;
revoke all on table public.interview_booking_slots from anon, authenticated;
grant select on table public.interview_booking_offers to authenticated;
grant select on table public.interview_booking_slots to authenticated;

-- -----------------------------------------------------------------------------
-- Núcleo común de programación (lo usan schedule_interview y la autoagenda)
-- -----------------------------------------------------------------------------
create function private.schedule_interview_core(
  p_application_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_modality public.interview_modality,
  p_location text,
  p_interviewers text,
  p_instructions text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.application_status;
  v_vacancy_status public.vacancy_status;
  v_id uuid;
begin
  select a.status, v.status into v_status, v_vacancy_status
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  where a.id = p_application_id
  for update of a;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;
  if v_vacancy_status = 'archivada' then
    raise exception 'La vacante está archivada' using errcode = 'RH409';
  end if;
  if v_status in ('seleccionado', 'no_seleccionado', 'retirado') then
    raise exception 'La postulación ya está cerrada: no admite nuevas entrevistas' using errcode = 'RH409';
  end if;
  if p_modality is null then
    raise exception 'Indique la modalidad de la entrevista' using errcode = 'RH422';
  end if;
  perform private.check_interview_fields(p_scheduled_at, p_duration_minutes, p_location, p_interviewers, p_instructions);

  insert into public.interviews (
    application_id, scheduled_at, duration_minutes, modality, location, interviewers, instructions
  )
  values (
    p_application_id,
    p_scheduled_at,
    p_duration_minutes,
    p_modality,
    nullif(btrim(p_location), ''),
    nullif(btrim(p_interviewers), ''),
    nullif(btrim(p_instructions), '')
  )
  returning id into v_id;

  insert into public.application_events (application_id, event_type, note, actor_id)
  values (
    p_application_id,
    'entrevista_programada',
    coalesce(p_note || '. ', '')
      || 'Para el ' || to_char(p_scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI')
      || ' (' || p_duration_minutes || ' min, ' || p_modality::text || ')',
    (select auth.uid())
  );

  if v_status <> 'entrevista_programada' then
    perform private.apply_application_status(
      p_application_id,
      v_status,
      'entrevista_programada',
      'Entrevista programada para el ' || to_char(p_scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI'),
      null
    );
  end if;

  -- Ya hay entrevista: una invitación a agendar pendiente deja de valer.
  update public.interview_booking_offers
  set status = 'cancelada', decided_at = now()
  where application_id = p_application_id and status = 'pendiente';

  return v_id;
end
$$;

revoke all on function private.schedule_interview_core(uuid, timestamptz, integer, public.interview_modality, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.schedule_interview(
  p_application_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 45,
  p_modality public.interview_modality default 'presencial',
  p_location text default null,
  p_interviewers text default null,
  p_instructions text default null
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
  if not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return private.schedule_interview_core(
    p_application_id, p_scheduled_at, p_duration_minutes, p_modality, p_location, p_interviewers, p_instructions
  );
end
$$;

-- ¿Quien invitó ya tiene otra entrevista programada que se superpone con este horario?
create function private.booking_slot_taken(p_owner uuid, p_starts_at timestamptz, p_duration_minutes integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner is not null and exists (
    select 1
    from public.interviews i
    where i.created_by = p_owner
      and i.status = 'programada'
      and tstzrange(i.scheduled_at, i.scheduled_at + make_interval(mins => i.duration_minutes))
          && tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes))
  )
$$;

revoke all on function private.booking_slot_taken(uuid, timestamptz, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Personal: crear y cancelar la invitación
-- -----------------------------------------------------------------------------
create function public.create_interview_booking(
  p_application_id uuid,
  p_slots timestamptz[],
  p_duration_minutes integer,
  p_modality public.interview_modality,
  p_location text,
  p_interviewers text,
  p_instructions text,
  p_interviewer_emails text[],
  p_expires_at timestamptz,
  p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.application_status;
  v_vacancy_status public.vacancy_status;
  v_count integer := coalesce(cardinality(p_slots), 0);
  v_slot timestamptz;
  v_emails text[];
  v_email text;
  v_id uuid;
begin
  if not private.is_staff() or not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select a.status, v.status into v_status, v_vacancy_status
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  where a.id = p_application_id
  for update of a;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;
  if v_vacancy_status = 'archivada' then
    raise exception 'La vacante está archivada' using errcode = 'RH409';
  end if;
  if v_status in ('seleccionado', 'no_seleccionado', 'retirado') then
    raise exception 'La postulación ya está cerrada: no admite nuevas entrevistas' using errcode = 'RH409';
  end if;
  if p_modality is null then
    raise exception 'Indique la modalidad de la entrevista' using errcode = 'RH422';
  end if;
  if v_count < 1 or v_count > 6 then
    raise exception 'Ofrezca de 1 a 6 horarios' using errcode = 'RH422';
  end if;
  if (select count(distinct s) from unnest(p_slots) s) <> v_count then
    raise exception 'Hay horarios repetidos' using errcode = 'RH422';
  end if;
  foreach v_slot in array p_slots loop
    perform private.check_interview_fields(v_slot, p_duration_minutes, p_location, p_interviewers, p_instructions);
    if v_slot < now() + interval '1 hour' then
      raise exception 'Cada horario debe ser al menos una hora después de ahora' using errcode = 'RH422';
    end if;
  end loop;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at >= (select max(s) from unnest(p_slots) s) then
    raise exception 'El plazo para elegir debe ser futuro y anterior al último horario' using errcode = 'RH422';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace inválido' using errcode = 'RH422';
  end if;

  -- Correos de los entrevistadores: mismas reglas que set_interview_interviewer_emails.
  select coalesce(array_agg(distinct lower(btrim(e))), '{}')
  into v_emails
  from unnest(coalesce(p_interviewer_emails, '{}')) as e
  where btrim(e) <> '';
  if cardinality(v_emails) > 10 then
    raise exception 'Indique hasta 10 correos de entrevistadores' using errcode = 'RH422';
  end if;
  foreach v_email in array v_emails loop
    if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Hay un correo de entrevistador no válido' using errcode = 'RH422';
    end if;
  end loop;

  -- Una pendiente que ya pasó su plazo no bloquea una invitación nueva (la tarea diaria
  -- la habría marcado «vencida» más tarde).
  update public.interview_booking_offers
  set status = 'vencida', decided_at = now()
  where application_id = p_application_id and status = 'pendiente' and expires_at <= now();

  if exists (
    select 1 from public.interview_booking_offers
    where application_id = p_application_id and status = 'pendiente'
  ) then
    raise exception 'Ya hay una invitación a agendar pendiente para esta postulación' using errcode = 'RH409';
  end if;

  insert into public.interview_booking_offers (
    application_id, created_by, token_hash, duration_minutes, modality, location, interviewers,
    interviewer_emails, instructions, expires_at
  )
  values (
    p_application_id, (select auth.uid()), p_token_hash, p_duration_minutes, p_modality,
    nullif(btrim(p_location), ''), nullif(btrim(p_interviewers), ''), v_emails,
    nullif(btrim(p_instructions), ''), p_expires_at
  )
  returning id into v_id;

  insert into public.interview_booking_slots (offer_id, starts_at)
  select v_id, s from unnest(p_slots) s;

  return v_id;
end
$$;

create function public.cancel_interview_booking(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.interview_booking_offers%rowtype;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into v_offer from public.interview_booking_offers where id = p_offer_id for update;
  if not found or not private.can_access_application(v_offer.application_id) then
    raise exception 'La invitación no existe' using errcode = 'RH404';
  end if;
  if v_offer.status <> 'pendiente' then
    raise exception 'La invitación ya no está pendiente' using errcode = 'RH409';
  end if;
  update public.interview_booking_offers
  set status = 'cancelada', decided_at = now()
  where id = p_offer_id;
end
$$;

-- «Copiar enlace»: la base guarda solo el hash, así que se emite un enlace nuevo
-- y el anterior deja de funcionar.
create function public.renew_interview_booking_link(p_offer_id uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.interview_booking_offers%rowtype;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace inválido' using errcode = 'RH422';
  end if;
  select * into v_offer from public.interview_booking_offers where id = p_offer_id for update;
  if not found or not private.can_access_application(v_offer.application_id) then
    raise exception 'La invitación no existe' using errcode = 'RH404';
  end if;
  -- Una invitación cuyo plazo ya pasó no se renueva: la persona vería «vencida» igual.
  if v_offer.status <> 'pendiente' or v_offer.expires_at <= now() then
    raise exception 'La invitación ya no está pendiente' using errcode = 'RH409';
  end if;
  update public.interview_booking_offers set token_hash = p_token_hash where id = p_offer_id;
end
$$;

revoke all on function public.create_interview_booking(uuid, timestamptz[], integer, public.interview_modality, text, text, text, text[], timestamptz, text)
  from public, anon;
revoke all on function public.cancel_interview_booking(uuid) from public, anon;
revoke all on function public.renew_interview_booking_link(uuid, text) from public, anon;
grant execute on function public.renew_interview_booking_link(uuid, text) to authenticated;
grant execute on function public.create_interview_booking(uuid, timestamptz[], integer, public.interview_modality, text, text, text, text[], timestamptz, text)
  to authenticated;
grant execute on function public.cancel_interview_booking(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Página pública (solo service_role, a través del servidor de la app)
-- -----------------------------------------------------------------------------

-- Lo que ve la persona: puesto, modalidad, duración, lugar, estado y los
-- horarios disponibles (futuros y no tomados). Nunca datos de otras personas.
create function public.get_interview_booking(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_offer public.interview_booking_offers%rowtype;
  v_title text;
  v_app_status public.application_status;
  v_status text;
  v_scheduled timestamptz;
  v_slots jsonb := '[]'::jsonb;
begin
  select * into v_offer from public.interview_booking_offers where token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  select v.title, a.status into v_title, v_app_status
  from public.applications a join public.vacancies v on v.id = a.vacancy_id
  where a.id = v_offer.application_id;

  v_status := case
    when v_offer.status = 'pendiente' and v_app_status in ('seleccionado', 'no_seleccionado', 'retirado') then 'cancelada'
    when v_offer.status = 'pendiente' and v_offer.expires_at <= now() then 'vencida'
    else v_offer.status::text
  end;

  if v_status = 'pendiente' then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at) order by s.starts_at), '[]'::jsonb)
    into v_slots
    from public.interview_booking_slots s
    where s.offer_id = v_offer.id
      and s.starts_at > now() + interval '15 minutes'
      and not private.booking_slot_taken(v_offer.created_by, s.starts_at, v_offer.duration_minutes);
  elsif v_status = 'agendada' then
    select i.scheduled_at into v_scheduled from public.interviews i where i.id = v_offer.interview_id;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'vacancy_title', v_title,
    'modality', v_offer.modality,
    'duration_minutes', v_offer.duration_minutes,
    -- El lugar solo mientras la invitación sigue viva: un enlace vencido o cancelado no lo muestra.
    'location', case when v_status in ('pendiente', 'agendada') then v_offer.location end,
    'expires_at', v_offer.expires_at,
    'scheduled_at', v_scheduled,
    'slots', v_slots
  );
end
$$;

-- La persona elige un horario: se crea la entrevista con el núcleo común y queda
-- a nombre de quien invitó (el historial la registra como agendada por la persona).
create function public.book_interview_slot(p_token_hash text, p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.interview_booking_offers%rowtype;
  v_starts timestamptz;
  v_interview uuid;
begin
  select * into v_offer from public.interview_booking_offers where token_hash = p_token_hash for update;
  if not found then
    raise exception 'La invitación no existe' using errcode = 'RH404';
  end if;
  if v_offer.status <> 'pendiente' or v_offer.expires_at <= now() then
    raise exception 'La invitación ya no está disponible' using errcode = 'RH409';
  end if;
  select s.starts_at into v_starts from public.interview_booking_slots s where s.id = p_slot_id and s.offer_id = v_offer.id;
  if not found then
    raise exception 'Ese horario no es parte de la invitación' using errcode = 'RH404';
  end if;

  -- Una elección a la vez por persona que invita: dos candidatos no toman la misma hora.
  perform pg_advisory_xact_lock(hashtextextended('interview_booking:' || coalesce(v_offer.created_by::text, v_offer.id::text), 0));
  if v_starts <= now() + interval '15 minutes'
     or private.booking_slot_taken(v_offer.created_by, v_starts, v_offer.duration_minutes) then
    raise exception 'Ese horario ya no está disponible' using errcode = 'RH409';
  end if;

  -- Primero se marca como agendada (el núcleo cancela las invitaciones pendientes).
  update public.interview_booking_offers set status = 'agendada', decided_at = now() where id = v_offer.id;
  v_interview := private.schedule_interview_core(
    v_offer.application_id, v_starts, v_offer.duration_minutes, v_offer.modality, v_offer.location,
    v_offer.interviewers, v_offer.instructions, 'Agendada por la persona candidata desde su invitación'
  );
  update public.interviews
  set created_by = v_offer.created_by, interviewer_emails = v_offer.interviewer_emails
  where id = v_interview;
  update public.interview_booking_offers set interview_id = v_interview where id = v_offer.id;
  return v_interview;
end
$$;

-- Tarea diaria: lo que pasó su plazo queda «vencida» y se avisa a quien invitó.
create function public.expire_interview_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.interview_booking_offers
    set status = 'vencida', decided_at = now()
    where status = 'pendiente' and expires_at <= now()
    returning application_id, created_by
  ),
  notified as (
    insert into public.notifications (recipient_id, kind, application_id)
    select e.created_by, 'agenda_vencida'::public.notification_kind, e.application_id
    from expired e
    where e.created_by is not null
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end
$$;

-- Una entrevista agendada por la persona también encola las preguntas para profundizar.
create function public.enqueue_system_interview_deep_dive(p_application_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_deep_dive_core(p_application_id, 'automatico', null)
$$;

-- Límite de la página pública (además del token, imposible de adivinar): 30
-- intentos por hora y por origen (HMAC de la IP, calculado en el servidor).
create function public.consume_booking_rate_limit(p_subject text)
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
  if random() < 0.02 then
    delete from private.rate_limits where key like 'booking:subject:%' and window_start < v_now - interval '2 hours';
  end if;
  insert into private.rate_limits as r (key, window_start, request_count)
  values ('booking:subject:' || p_subject, v_now, 1)
  on conflict (key) do update
    set request_count = case when r.window_start <= v_now - interval '1 hour' then 1 else r.request_count + 1 end,
        window_start = case when r.window_start <= v_now - interval '1 hour' then v_now else r.window_start end
  returning request_count into v_count;
  return v_count <= 30;
end
$$;

revoke all on function public.consume_booking_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_booking_rate_limit(text) to service_role;

revoke all on function public.get_interview_booking(text) from public, anon, authenticated;
revoke all on function public.book_interview_slot(text, uuid) from public, anon, authenticated;
revoke all on function public.expire_interview_bookings() from public, anon, authenticated;
revoke all on function public.enqueue_system_interview_deep_dive(uuid) from public, anon, authenticated;
grant execute on function public.get_interview_booking(text) to service_role;
grant execute on function public.book_interview_slot(text, uuid) to service_role;
grant execute on function public.expire_interview_bookings() to service_role;
grant execute on function public.enqueue_system_interview_deep_dive(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Una invitación pendiente no sobrevive al cierre de la postulación ni al archivo
-- de la vacante (no se avisa «no eligió horario» de algo que ya no corre).
-- -----------------------------------------------------------------------------
create function private.cancel_bookings_when_application_closes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('seleccionado', 'no_seleccionado', 'retirado') and old.status is distinct from new.status then
    update public.interview_booking_offers
    set status = 'cancelada', decided_at = now()
    where application_id = new.id and status = 'pendiente';
  end if;
  return null;
end
$$;

create trigger applications_cancel_bookings_on_close
  after update of status on public.applications
  for each row execute function private.cancel_bookings_when_application_closes();

create function private.cancel_bookings_when_vacancy_archived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'archivada' and old.status is distinct from new.status then
    update public.interview_booking_offers o
    set status = 'cancelada', decided_at = now()
    from public.applications a
    where a.id = o.application_id and a.vacancy_id = new.id and o.status = 'pendiente';
  end if;
  return null;
end
$$;

create trigger vacancies_cancel_bookings_on_archive
  after update of status on public.vacancies
  for each row execute function private.cancel_bookings_when_vacancy_archived();

-- -----------------------------------------------------------------------------
-- anonymize_candidate: igual que en 20261120100000_preguntas_profundizar.sql, más
-- el lugar y las indicaciones de las invitaciones a agendar.
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

  -- Invitaciones a agendar (20261120200000): lugar e indicaciones son texto libre.
  update public.interview_booking_offers o
  set location = null, instructions = null
  from public.applications a
  where a.id = o.application_id and a.candidate_id = p_candidate_id
    and (o.location is not null or o.instructions is not null);

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
