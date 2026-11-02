-- =============================================================================
-- Entrevistas
--
-- RRHH agenda entrevistas por postulación, registra su resultado (pasó / no
-- pasó / no asistió) y aprovecha la entrevista para marcar requisitos
-- comprobados. Quien no pasó sale del proceso activo (no_seleccionado) sin
-- borrar nada: el historial, la evaluación y las verificaciones se conservan.
--
-- * interviews: solo lectura directa; se escribe con schedule_interview,
--   reschedule_interview, cancel_interview y record_interview_result.
-- * Las verificaciones de requisitos usan ahora una función privada común
--   (verify_requirements conserva su firma y sus privilegios).
-- * Los cambios de estado de las entrevistas usan la misma rutina privada que
--   change_application_status.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
create type public.interview_modality as enum ('presencial', 'virtual', 'telefonica');
create type public.interview_status as enum ('programada', 'realizada', 'no_asistio', 'cancelada');
create type public.interview_result as enum ('paso', 'no_paso');

-- Los valores nuevos no se usan en esta migración (solo dentro de cuerpos de
-- funciones, que se resuelven al ejecutarse).
alter type public.application_event_type add value if not exists 'entrevista_programada';
alter type public.application_event_type add value if not exists 'entrevista_reprogramada';
alter type public.application_event_type add value if not exists 'entrevista_cancelada';
alter type public.application_event_type add value if not exists 'entrevista_resultado';

-- -----------------------------------------------------------------------------
-- 2. Tabla
-- -----------------------------------------------------------------------------
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  scheduled_at timestamptz not null,
  duration_minutes smallint not null default 45 check (duration_minutes between 15 and 480),
  modality public.interview_modality not null,
  -- Dirección o enlace de la reunión.
  location text check (char_length(location) <= 500),
  -- Nombres libres: los entrevistadores pueden no ser usuarios de la plataforma.
  interviewers text check (char_length(interviewers) <= 300),
  instructions text check (char_length(instructions) <= 2000),
  status public.interview_status not null default 'programada',
  result public.interview_result,
  result_notes text check (char_length(result_notes) <= 4000),
  result_recorded_by uuid references public.profiles (id) on delete set null,
  result_recorded_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviews_result_matches_status check ((status = 'realizada') = (result is not null)),
  constraint interviews_no_paso_needs_notes
    check (result is distinct from 'no_paso' or char_length(btrim(coalesce(result_notes, ''))) >= 3),
  constraint interviews_cancel_needs_reason
    check (status <> 'cancelada' or char_length(btrim(coalesce(cancel_reason, ''))) >= 3)
);

create index interviews_scheduled_at_idx on public.interviews (scheduled_at);
create index interviews_application_idx on public.interviews (application_id);

create trigger interviews_set_created_by before insert on public.interviews
  for each row execute function private.set_actor_column('created_by');

create trigger interviews_set_updated_at before update on public.interviews
  for each row execute function private.set_updated_at();

create trigger interviews_audit
  after insert or update or delete on public.interviews
  for each row execute function private.audit_row_change();

alter table public.interviews enable row level security;

create policy interviews_select on public.interviews
  for select to authenticated
  using (private.can_access_application(application_id));

revoke all on table public.interviews from anon, authenticated;
grant select on table public.interviews to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Verificaciones: vínculo con la entrevista y guardado común
-- -----------------------------------------------------------------------------
alter table public.requirement_verifications
  add column interview_id uuid references public.interviews (id) on delete set null;

create index requirement_verifications_interview_idx
  on public.requirement_verifications (interview_id) where interview_id is not null;

-- Valida y guarda verificaciones [{requirement_id, result, source, note}] (de 1
-- a 30) y registra el evento. Sin comprobaciones de acceso: las hace quien la
-- llama. p_interview_id vincula las verificaciones con una entrevista.
create function private.save_requirement_verifications(
  p_application_id uuid,
  p_items jsonb,
  p_interview_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy_id uuid;
  v_item jsonb;
  v_requirement_id uuid;
  v_ids uuid[] := '{}';
  v_note text;
  v_count integer;
begin
  select vacancy_id into v_vacancy_id from public.applications where id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Indique de 1 a 30 verificaciones' using errcode = 'RH422';
  end if;

  -- Validación completa antes de escribir.
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Formato de verificación inválido' using errcode = 'RH422';
    end if;
    v_requirement_id := private.try_uuid(v_item ->> 'requirement_id');
    if v_requirement_id is null or not exists (
      select 1 from public.vacancy_requirements r
      where r.id = v_requirement_id and r.vacancy_id = v_vacancy_id
    ) then
      raise exception 'El requisito no pertenece a la vacante de la postulación' using errcode = 'RH422';
    end if;
    if v_requirement_id = any (v_ids) then
      raise exception 'Un requisito no puede verificarse dos veces en la misma solicitud' using errcode = 'RH422';
    end if;
    v_ids := v_ids || v_requirement_id;
    if (v_item ->> 'result') is null or (v_item ->> 'result') not in ('acreditado', 'no_cumplido') then
      raise exception 'El resultado de la verificación debe ser «cumple» o «no cumple»' using errcode = 'RH422';
    end if;
    if (v_item ->> 'source') is null
       or (v_item ->> 'source') not in (select unnest(enum_range(null::public.verification_source))::text) then
      raise exception 'La fuente de la verificación no es válida' using errcode = 'RH422';
    end if;
    v_note := btrim(coalesce(v_item ->> 'note', ''));
    if char_length(v_note) not between 3 and 1000 then
      raise exception 'La nota de la verificación debe tener entre 3 y 1000 caracteres' using errcode = 'RH422';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.requirement_verifications as v (
      application_id, requirement_id, result, source, note, interview_id, verified_by, verified_at
    )
    values (
      p_application_id,
      (v_item ->> 'requirement_id')::uuid,
      (v_item ->> 'result')::public.requirement_assessment,
      (v_item ->> 'source')::public.verification_source,
      btrim(v_item ->> 'note'),
      p_interview_id,
      (select auth.uid()),
      now()
    )
    on conflict (application_id, requirement_id) do update
      set result = excluded.result,
          source = excluded.source,
          note = excluded.note,
          interview_id = excluded.interview_id,
          verified_by = excluded.verified_by,
          verified_at = excluded.verified_at;
  end loop;

  v_count := jsonb_array_length(p_items);
  insert into public.application_events (application_id, event_type, note, actor_id)
  values (
    p_application_id,
    'requisito_verificado',
    case when v_count = 1 then '1 requisito verificado' else v_count || ' requisitos verificados' end,
    (select auth.uid())
  );

  return v_count;
end
$$;

revoke all on function private.save_requirement_verifications(uuid, jsonb, uuid) from public, anon, authenticated;

-- Misma firma y mismos privilegios que en 20261028001000_requirement_verifications.sql.
create or replace function public.verify_requirements(p_application_id uuid, p_items jsonb)
returns integer
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
  return private.save_requirement_verifications(p_application_id, p_items, null);
end
$$;

revoke all on function public.verify_requirements(uuid, jsonb) from public, anon;
grant execute on function public.verify_requirements(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Cambio de estado común
-- change_application_status y las funciones de entrevistas usan esta rutina,
-- que actualiza el estado y registra el evento cambio_estado. Sin
-- comprobaciones: las hace quien la llama.
-- -----------------------------------------------------------------------------
create function private.apply_application_status(
  p_application_id uuid,
  p_old public.application_status,
  p_new public.application_status,
  p_reason text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications
  set status = p_new,
      status_changed_at = now()
  where id = p_application_id;

  insert into public.application_events (
    application_id, event_type, from_status, to_status, reason, note, actor_id
  )
  values (
    p_application_id,
    'cambio_estado',
    p_old,
    p_new,
    left(nullif(btrim(p_reason), ''), 500),
    nullif(btrim(p_note), ''),
    (select auth.uid())
  );
end
$$;

revoke all on function private.apply_application_status(uuid, public.application_status, public.application_status, text, text)
  from public, anon, authenticated;

-- Mismo comportamiento y privilegios que en 20261022000300_candidates.sql.
create or replace function public.change_application_status(
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

  perform private.apply_application_status(p_application_id, v_old, p_new_status, p_reason, p_note);
end
$$;

revoke all on function public.change_application_status(uuid, public.application_status, text, text) from public, anon;
grant execute on function public.change_application_status(uuid, public.application_status, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Validación común de los datos de una entrevista
-- Devuelve los textos ya recortados (null si quedan vacíos).
-- -----------------------------------------------------------------------------
create function private.check_interview_fields(
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_interviewers text,
  p_instructions text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_scheduled_at is null then
    raise exception 'Indique la fecha y la hora de la entrevista' using errcode = 'RH422';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 15 and 480 then
    raise exception 'La duración debe estar entre 15 y 480 minutos' using errcode = 'RH422';
  end if;
  if char_length(btrim(coalesce(p_location, ''))) > 500 then
    raise exception 'El lugar o enlace admite hasta 500 caracteres' using errcode = 'RH422';
  end if;
  if char_length(btrim(coalesce(p_interviewers, ''))) > 300 then
    raise exception 'Los entrevistadores admiten hasta 300 caracteres' using errcode = 'RH422';
  end if;
  if char_length(btrim(coalesce(p_instructions, ''))) > 2000 then
    raise exception 'Las indicaciones admiten hasta 2000 caracteres' using errcode = 'RH422';
  end if;
end
$$;

revoke all on function private.check_interview_fields(timestamptz, integer, text, text, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. schedule_interview
-- -----------------------------------------------------------------------------
create function public.schedule_interview(
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
declare
  v_status public.application_status;
  v_vacancy_status public.vacancy_status;
  v_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not private.can_access_application(p_application_id) then
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
    'Para el ' || to_char(p_scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI')
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

  return v_id;
end
$$;

revoke all on function public.schedule_interview(uuid, timestamptz, integer, public.interview_modality, text, text, text) from public, anon;
grant execute on function public.schedule_interview(uuid, timestamptz, integer, public.interview_modality, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. reschedule_interview
-- -----------------------------------------------------------------------------
create function public.reschedule_interview(
  p_interview_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 45,
  p_modality public.interview_modality default 'presencial',
  p_location text default null,
  p_interviewers text default null,
  p_instructions text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_interview from public.interviews where id = p_interview_id for update;
  if not found then
    raise exception 'La entrevista no existe' using errcode = 'RH404';
  end if;
  if not private.can_access_application(v_interview.application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_interview.status <> 'programada' then
    raise exception 'Solo se puede reprogramar una entrevista programada' using errcode = 'RH409';
  end if;
  if p_modality is null then
    raise exception 'Indique la modalidad de la entrevista' using errcode = 'RH422';
  end if;
  perform private.check_interview_fields(p_scheduled_at, p_duration_minutes, p_location, p_interviewers, p_instructions);

  update public.interviews
  set scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      modality = p_modality,
      location = nullif(btrim(p_location), ''),
      interviewers = nullif(btrim(p_interviewers), ''),
      instructions = nullif(btrim(p_instructions), '')
  where id = p_interview_id;

  insert into public.application_events (application_id, event_type, note, actor_id)
  values (
    v_interview.application_id,
    'entrevista_reprogramada',
    'Del ' || to_char(v_interview.scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI')
      || ' al ' || to_char(p_scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI')
      || ' (' || p_duration_minutes || ' min, ' || p_modality::text || ')',
    (select auth.uid())
  );
end
$$;

revoke all on function public.reschedule_interview(uuid, timestamptz, integer, public.interview_modality, text, text, text) from public, anon;
grant execute on function public.reschedule_interview(uuid, timestamptz, integer, public.interview_modality, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. cancel_interview: no cambia el estado de la postulación.
-- -----------------------------------------------------------------------------
create function public.cancel_interview(p_interview_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_interview from public.interviews where id = p_interview_id for update;
  if not found then
    raise exception 'La entrevista no existe' using errcode = 'RH404';
  end if;
  if not private.can_access_application(v_interview.application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_interview.status <> 'programada' then
    raise exception 'Solo se puede cancelar una entrevista programada' using errcode = 'RH409';
  end if;
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'El motivo de la cancelación debe tener entre 3 y 500 caracteres' using errcode = 'RH422';
  end if;

  update public.interviews
  set status = 'cancelada',
      cancel_reason = v_reason
  where id = p_interview_id;

  insert into public.application_events (application_id, event_type, reason, note, actor_id)
  values (
    v_interview.application_id,
    'entrevista_cancelada',
    v_reason,
    'Entrevista del ' || to_char(v_interview.scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI'),
    (select auth.uid())
  );
end
$$;

revoke all on function public.cancel_interview(uuid, text) from public, anon;
grant execute on function public.cancel_interview(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. record_interview_result
-- p_outcome: paso | no_paso | no_asistio.
-- p_verifications: [{requirement_id, result, note?}], de 0 a 30; se guardan con
-- fuente «entrevista» y se ignoran si no asistió. Devuelve el id de la
-- postulación.
-- -----------------------------------------------------------------------------
create function public.record_interview_result(
  p_interview_id uuid,
  p_outcome text,
  p_notes text default null,
  p_verifications jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
  v_status public.application_status;
  v_vacancy_status public.vacancy_status;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_date text;
  v_active boolean;
  v_items jsonb;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_interview from public.interviews where id = p_interview_id for update;
  if not found then
    raise exception 'La entrevista no existe' using errcode = 'RH404';
  end if;
  if not private.can_access_application(v_interview.application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_interview.status <> 'programada' then
    raise exception 'Solo se puede registrar el resultado de una entrevista programada' using errcode = 'RH409';
  end if;
  if p_outcome is null or p_outcome not in ('paso', 'no_paso', 'no_asistio') then
    raise exception 'El resultado debe ser «pasó», «no pasó» o «no asistió»' using errcode = 'RH422';
  end if;
  if v_notes is not null and char_length(v_notes) > 4000 then
    raise exception 'Las notas admiten hasta 4000 caracteres' using errcode = 'RH422';
  end if;
  if p_outcome = 'no_paso' and (v_notes is null or char_length(v_notes) < 3) then
    raise exception 'Indique el motivo: la nota debe tener al menos 3 caracteres' using errcode = 'RH422';
  end if;
  if p_verifications is null or jsonb_typeof(p_verifications) <> 'array'
     or jsonb_array_length(p_verifications) > 30 then
    raise exception 'Indique de 0 a 30 requisitos comprobados' using errcode = 'RH422';
  end if;

  select a.status, v.status into v_status, v_vacancy_status
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  where a.id = v_interview.application_id
  for update of a;

  v_date := to_char(v_interview.scheduled_at at time zone 'America/Lima', 'DD/MM/YYYY');
  -- En una vacante archivada se registra el resultado, pero el estado no cambia.
  v_active := v_status not in ('seleccionado', 'no_seleccionado', 'retirado')
    and v_vacancy_status <> 'archivada';

  if p_outcome = 'no_asistio' then
    update public.interviews
    set status = 'no_asistio',
        result_notes = v_notes,
        result_recorded_by = (select auth.uid()),
        result_recorded_at = now()
    where id = p_interview_id;
  else
    update public.interviews
    set status = 'realizada',
        result = p_outcome::public.interview_result,
        result_notes = v_notes,
        result_recorded_by = (select auth.uid()),
        result_recorded_at = now()
    where id = p_interview_id;

    -- Requisitos comprobados en la entrevista.
    if jsonb_array_length(p_verifications) > 0 then
      select jsonb_agg(jsonb_build_object(
        'requirement_id', e.value ->> 'requirement_id',
        'result', e.value ->> 'result',
        'source', 'entrevista',
        'note', coalesce(nullif(btrim(e.value ->> 'note'), ''), 'Comprobado en la entrevista del ' || v_date)
      ))
      into v_items
      from jsonb_array_elements(p_verifications) e;
      perform private.save_requirement_verifications(v_interview.application_id, v_items, p_interview_id);
    end if;

    if v_active and p_outcome = 'paso' and v_status <> 'en_evaluacion' then
      perform private.apply_application_status(
        v_interview.application_id, v_status, 'en_evaluacion', 'Pasó la entrevista del ' || v_date, null
      );
    elsif v_active and p_outcome = 'no_paso' then
      perform private.apply_application_status(
        v_interview.application_id,
        v_status,
        'no_seleccionado',
        'No pasó la entrevista del ' || v_date || ': ' || v_notes,
        null
      );
    end if;
  end if;

  insert into public.application_events (application_id, event_type, reason, note, actor_id)
  values (
    v_interview.application_id,
    'entrevista_resultado',
    case p_outcome when 'paso' then 'Pasó' when 'no_paso' then 'No pasó' else 'No asistió' end,
    left('Entrevista del ' || v_date || coalesce(': ' || v_notes, ''), 4000),
    (select auth.uid())
  );

  return v_interview.application_id;
end
$$;

revoke all on function public.record_interview_result(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_interview_result(uuid, text, text, jsonb) to authenticated;
