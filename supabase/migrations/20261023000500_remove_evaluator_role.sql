-- =============================================================================
-- 0010 · Eliminación del rol evaluador
--
-- Decisión de RRHH del 23/10/2026: por ahora el rol no se usa. Si vuelve a ser
-- necesario se implementará de nuevo. Quedan dos roles, administración y RRHH,
-- y ambos acceden a todas las vacantes, por lo que desaparecen los equipos de
-- vacante.
--
-- Requisito: ninguna cuenta vigente puede tener el rol evaluador (se eliminan
-- antes desde la papelera). Los perfiles ya eliminados que lo tenían conservan
-- su nombre para el historial y quedan sin rol.
--
-- Las cuentas creadas sin un rol válido nacen desactivadas (en la papelera)
-- hasta que un administrador las active. Antes nacían como evaluador sin
-- vacantes, es decir, sin acceso; ahora el rol mínimo da acceso a todo.
-- =============================================================================

do $$
begin
  if exists (select 1 from public.profiles p where p.role = 'evaluador' and p.deleted_at is null) then
    raise exception 'Aún hay cuentas con rol evaluador: elimínelas desde la papelera o cambie su rol antes de aplicar esta migración';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Acceso: administración y RRHH ven todo (se conservan las funciones porque
-- las usan las políticas de RLS).
-- -----------------------------------------------------------------------------
create or replace function private.can_access_vacancy(p_vacancy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff()
$$;

create or replace function private.can_access_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff()
$$;

create or replace function private.can_access_candidate(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff()
$$;

-- -----------------------------------------------------------------------------
-- Pedir opinión: a cualquier persona activa (ya no hay equipos)
-- -----------------------------------------------------------------------------
create or replace function private.check_assigned_evaluator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_evaluator_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.assigned_evaluator_id and p.is_active
  ) then
    raise exception 'La persona consultada debe tener una cuenta activa' using errcode = 'RH422';
  end if;
  return new;
end
$$;

drop function public.request_opinion(uuid, uuid, boolean);

create function public.request_opinion(p_application_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_profile_id = (select auth.uid()) then
    raise exception 'No puede pedirse su propia opinión' using errcode = 'RH422';
  end if;

  select a.assigned_evaluator_id
  into v_previous
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

revoke all on function public.request_opinion(uuid, uuid) from public, anon;
grant execute on function public.request_opinion(uuid, uuid) to authenticated;

-- Al eliminar una cuenta: perfil histórico, sin solicitudes de opinión vigentes
-- ni notificaciones (versión 0007 sin los equipos de vacante).
create or replace function private.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set is_active = false,
      deleted_at = now(),
      email = '',
      full_name = left(full_name, 148) || ' (eliminado)'
  where id = old.id
    and deleted_at is null;

  update public.applications
  set assigned_evaluator_id = null
  where assigned_evaluator_id = old.id;

  delete from public.notifications where recipient_id = old.id;

  return old;
end
$$;

delete from public.notifications n
using public.profiles p
where p.id = n.recipient_id and p.deleted_at is not null;

drop table public.vacancy_members;

-- -----------------------------------------------------------------------------
-- Rol: solo administración y RRHH
-- -----------------------------------------------------------------------------
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role drop not null;
update public.profiles set role = null where role = 'evaluador';

alter type public.app_role rename to app_role_old;
create type public.app_role as enum ('admin', 'rrhh');
alter table public.profiles alter column role type public.app_role using role::text::public.app_role;
alter table public.profiles alter column role set default 'rrhh';
alter table public.profiles
  add constraint profiles_role_required check (role is not null or deleted_at is not null);

-- La función devolvía el tipo anterior: se recrea con el nuevo.
drop function private.current_app_role();
create function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;
revoke all on function private.current_app_role() from public;
grant execute on function private.current_app_role() to authenticated, service_role;

drop type public.app_role_old;

-- Alta de perfiles: sin rol válido en app_metadata, la cuenta nace desactivada.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  if new.raw_app_meta_data ->> 'role' in ('admin', 'rrhh') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.app_role;
  end if;

  insert into public.profiles (id, full_name, email, role, is_active, deactivated_at)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Usuario'
      ),
      160
    ),
    coalesce(new.email, ''),
    coalesce(v_role, 'rrhh'),
    v_role is not null,
    case when v_role is null then now() end
  );
  return new;
end
$$;
