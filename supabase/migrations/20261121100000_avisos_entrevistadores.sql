-- =============================================================================
-- Avisos por correo a los entrevistadores: resultado del último envío a cada uno
-- (invitación, cambio o cancelación de la entrevista). La pantalla decía
-- «Avisos a N entrevistadores» aunque el servicio de correo hubiera rechazado el
-- envío; ahora muestra lo que pasó (src/modules/interviews/notices.ts).
--
-- Mismo patrón que interview_reminders: lectura para quien accede a la
-- entrevista; escritura solo por la función del servicio. Los destinatarios son
-- correos del personal, no datos de la persona candidata.
-- =============================================================================

create table public.interview_interviewer_notices (
  interview_id uuid not null references public.interviews (id) on delete cascade,
  recipient text not null check (char_length(recipient) between 3 and 254),
  outcome text not null check (outcome in ('enviado', 'no_enviado', 'desactivado')),
  notified_at timestamptz not null default now(),
  primary key (interview_id, recipient)
);

alter table public.interview_interviewer_notices enable row level security;

create policy interview_interviewer_notices_select on public.interview_interviewer_notices
  for select to authenticated
  using (private.can_access_interview(interview_id));

revoke all on table public.interview_interviewer_notices from anon, authenticated;
grant select on table public.interview_interviewer_notices to authenticated;

-- Guarda (o reemplaza) el resultado del último aviso a un entrevistador.
create function public.record_interviewer_notice(p_interview_id uuid, p_recipient text, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome is null or p_outcome not in ('enviado', 'no_enviado', 'desactivado') then
    raise exception 'Resultado de aviso no válido' using errcode = 'RH422';
  end if;
  insert into public.interview_interviewer_notices (interview_id, recipient, outcome, notified_at)
  values (p_interview_id, lower(btrim(p_recipient)), p_outcome, now())
  on conflict (interview_id, recipient)
  do update set outcome = excluded.outcome, notified_at = excluded.notified_at;
end
$$;

revoke all on function public.record_interviewer_notice(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_interviewer_notice(uuid, text, text) to service_role;
