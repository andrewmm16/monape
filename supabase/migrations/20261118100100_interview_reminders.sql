-- =============================================================================
-- Recordatorios automáticos de entrevista y avisos a los entrevistadores
--
-- 1. interviews.interviewer_emails: correos (opcionales) de quienes entrevistan.
--    `interviewers` sigue siendo texto libre con los nombres; los correos van
--    aparte porque pueden ser personas sin cuenta en la plataforma. Se guardan
--    con set_interview_interviewer_emails, después de agendar o reprogramar
--    (mismo patrón que set_interview_coordinates).
--
-- 2. Una tarea programada (GET /api/tareas/recordatorios-entrevista) envía el
--    recordatorio de cada entrevista «programada» próxima a la persona
--    candidata y a cada entrevistador con correo.
--    * interview_reminders: un recordatorio por entrevista, fecha y
--      destinatario ('candidato' o el correo del entrevistador). Si la
--      entrevista se reprograma, la fecha nueva admite su propio recordatorio.
--    * claim_due_interview_reminders reserva de forma atómica los que tocan
--      (dos ejecuciones simultáneas no envían dos veces). No reserva los de
--      entrevistas agendadas o modificadas hace poco: acaban de recibir la
--      invitación o el aviso de cambio.
--    * finish_interview_reminder guarda el resultado; si el envío falló, libera
--      la reserva para reintentar en la siguiente ejecución.
--    Ambas funciones son solo para la clave de servicio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Correos de los entrevistadores
-- -----------------------------------------------------------------------------
alter table public.interviews
  add column interviewer_emails text[] not null default '{}';

alter table public.interviews
  add constraint interviews_interviewer_emails_max check (cardinality(interviewer_emails) <= 10);

-- Valida, normaliza (minúsculas, sin repetidos) y guarda los correos. Mismas
-- comprobaciones de acceso que reschedule_interview; solo entrevistas programadas.
create function public.set_interview_interviewer_emails(p_interview_id uuid, p_emails text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
  v_emails text[];
  v_email text;
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
    raise exception 'Solo se pueden cambiar los entrevistadores de una entrevista programada' using errcode = 'RH409';
  end if;

  select coalesce(array_agg(distinct lower(btrim(e))), '{}')
  into v_emails
  from unnest(coalesce(p_emails, '{}')) as e
  where btrim(e) <> '';

  if cardinality(v_emails) > 10 then
    raise exception 'Indique hasta 10 correos de entrevistadores' using errcode = 'RH422';
  end if;
  foreach v_email in array v_emails loop
    if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Hay un correo de entrevistador no válido' using errcode = 'RH422';
    end if;
  end loop;

  update public.interviews
  set interviewer_emails = v_emails
  where id = p_interview_id and interviewer_emails is distinct from v_emails;
end
$$;

revoke all on function public.set_interview_interviewer_emails(uuid, text[]) from public, anon;
grant execute on function public.set_interview_interviewer_emails(uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Recordatorios
-- -----------------------------------------------------------------------------
create type public.interview_reminder_outcome as enum ('enviando', 'enviado', 'sin_correo');

create table public.interview_reminders (
  interview_id uuid not null references public.interviews (id) on delete cascade,
  -- Fecha de la entrevista a la que se refiere el recordatorio.
  scheduled_at timestamptz not null,
  -- 'candidato' o el correo del entrevistador.
  recipient text not null check (char_length(recipient) between 1 and 254),
  outcome public.interview_reminder_outcome not null default 'enviando',
  created_at timestamptz not null default now(),
  primary key (interview_id, scheduled_at, recipient)
);

alter table public.interview_reminders enable row level security;

create policy interview_reminders_select on public.interview_reminders
  for select to authenticated
  using (private.can_access_interview(interview_id));

revoke all on table public.interview_reminders from anon, authenticated;
grant select on table public.interview_reminders to authenticated;

-- p_hours_before: ventana hacia adelante (entrevistas que empiezan dentro de N h).
-- p_min_notice_hours: horas mínimas desde que se agendó o modificó la entrevista.
create function public.claim_due_interview_reminders(
  p_hours_before integer default 24,
  p_min_notice_hours integer default 12,
  p_limit integer default 200
)
returns table (interview_id uuid, scheduled_at timestamptz, recipient text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_hours_before is null or p_hours_before not between 1 and 72 then
    raise exception 'La ventana debe estar entre 1 y 72 horas' using errcode = 'RH422';
  end if;
  if p_min_notice_hours is null or p_min_notice_hours not between 0 and 48 then
    raise exception 'La antelación mínima debe estar entre 0 y 48 horas' using errcode = 'RH422';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'El límite debe estar entre 1 y 1000' using errcode = 'RH422';
  end if;

  -- Reservas de una ejecución que se cortó a mitad del envío: se liberan.
  delete from public.interview_reminders as stale
  where stale.outcome = 'enviando' and stale.created_at < now() - interval '30 minutes';

  return query
  insert into public.interview_reminders as r (interview_id, scheduled_at, recipient)
  select due.id, due.scheduled_at, due.recipient
  from (
    select i.id, i.scheduled_at, recipients.recipient
    from public.interviews i
    cross join lateral (
      select 'candidato'::text as recipient
      union all
      select unnest(i.interviewer_emails)
    ) as recipients
    where i.status = 'programada'
      and i.scheduled_at > now()
      and i.scheduled_at <= now() + make_interval(hours => p_hours_before)
      and i.updated_at <= now() - make_interval(hours => p_min_notice_hours)
    order by i.scheduled_at
    limit p_limit
  ) as due
  on conflict do nothing
  returning r.interview_id, r.scheduled_at, r.recipient;
end
$$;

revoke all on function public.claim_due_interview_reminders(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_interview_reminders(integer, integer, integer) to service_role;

-- p_outcome: 'enviado' | 'sin_correo' guardan el resultado; 'error' libera la
-- reserva (se reintenta en la siguiente ejecución, si sigue dentro de la ventana).
create function public.finish_interview_reminder(
  p_interview_id uuid,
  p_scheduled_at timestamptz,
  p_recipient text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome = 'error' then
    delete from public.interview_reminders
    where interview_id = p_interview_id and scheduled_at = p_scheduled_at
      and recipient = p_recipient and outcome = 'enviando';
  elsif p_outcome in ('enviado', 'sin_correo') then
    update public.interview_reminders
    set outcome = p_outcome::public.interview_reminder_outcome
    where interview_id = p_interview_id and scheduled_at = p_scheduled_at and recipient = p_recipient;
  else
    raise exception 'Resultado de recordatorio no válido' using errcode = 'RH422';
  end if;
end
$$;

revoke all on function public.finish_interview_reminder(uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.finish_interview_reminder(uuid, timestamptz, text, text) to service_role;
