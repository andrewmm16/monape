-- =============================================================================
-- 0009 · Pedir opinión a cualquier evaluador
--
-- Un evaluador solo ve los candidatos de las vacantes en cuyo equipo está.
-- Para pedirle opinión a uno que no forma parte del equipo, RRHH lo confirma
-- (p_add_to_team) y la función lo agrega al equipo en la misma transacción.
-- Sin esa confirmación, la regla anterior se mantiene.
-- =============================================================================

drop function public.request_opinion(uuid, uuid);

create function public.request_opinion(
  p_application_id uuid,
  p_profile_id uuid,
  p_add_to_team boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_vacancy_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_profile_id = (select auth.uid()) then
    raise exception 'No puede pedirse su propia opinión' using errcode = 'RH422';
  end if;

  select a.assigned_evaluator_id, a.vacancy_id
  into v_previous, v_vacancy_id
  from public.applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;
  if exists (select 1 from public.vacancies v where v.id = v_vacancy_id and v.status = 'archivada') then
    raise exception 'La vacante está archivada' using errcode = 'RH409';
  end if;

  -- added_by lo fija el disparador con el usuario de la sesión.
  if p_add_to_team and exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.is_active and p.role = 'evaluador'
  ) then
    insert into public.vacancy_members (vacancy_id, profile_id)
    values (v_vacancy_id, p_profile_id)
    on conflict do nothing;
  end if;

  -- check_assigned_evaluator valida que la persona esté activa y, si es
  -- evaluador, que forme parte del equipo de la vacante.
  update public.applications
  set assigned_evaluator_id = p_profile_id,
      opinion_requested_at = case when p_profile_id is null then null else now() end,
      opinion_requested_by = case when p_profile_id is null then null else (select auth.uid()) end,
      opinion_answered_at = null
  where id = p_application_id;

  -- La notificación anterior sin leer ya no corresponde.
  if v_previous is not null then
    delete from public.notifications n
    where n.application_id = p_application_id
      and n.recipient_id = v_previous
      and n.kind = 'opinion_solicitada'
      and n.read_at is null;
  end if;

  if p_profile_id is not null then
    insert into public.notifications (recipient_id, kind, application_id, actor_id)
    values (p_profile_id, 'opinion_solicitada', p_application_id, (select auth.uid()));
  end if;
end
$$;

revoke all on function public.request_opinion(uuid, uuid, boolean) from public, anon;
grant execute on function public.request_opinion(uuid, uuid, boolean) to authenticated;

-- Mismo control que en 0003, con el mensaje adaptado a «pedir opinión».
create or replace function private.check_assigned_evaluator()
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
    raise exception 'La persona consultada debe estar activa y, si es evaluador, formar parte del equipo de la vacante'
      using errcode = 'RH422';
  end if;
  return new;
end
$$;
