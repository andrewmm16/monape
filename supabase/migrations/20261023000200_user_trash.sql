-- =============================================================================
-- 0007 · Papelera de usuarios
--
-- Un usuario desactivado pasa a la papelera. Desde ahí un administrador lo
-- reactiva o lo elimina definitivamente.
--
-- Eliminar definitivamente borra la cuenta de Supabase Auth: correo,
-- contraseña y sesiones, y el correo queda libre para una nueva invitación.
-- El perfil se conserva como registro histórico, sin correo y con el nombre
-- marcado «(eliminado)», para que el historial siga indicando quién hizo cada
-- cambio. Por eso el perfil deja de depender de auth.users: un disparador lo
-- convierte en registro histórico cuando se borra la cuenta, también si se
-- borra desde el panel de Supabase.
-- =============================================================================

alter table public.profiles
  add column deactivated_at timestamptz,
  add column deleted_at timestamptz,
  add constraint profiles_deleted_inactive check (deleted_at is null or not is_active);

comment on column public.profiles.deactivated_at is
  'Fecha en que el usuario pasó a la papelera. Nulo si está activo o si se desactivó antes de existir esta columna.';
comment on column public.profiles.deleted_at is
  'Fecha de eliminación definitiva. El perfil se conserva solo para el historial.';

alter table public.profiles drop constraint profiles_id_fkey;

-- Reglas de integridad de perfiles (versión 0001 más la papelera): un perfil
-- eliminado no se modifica ni se reactiva, y la desactivación registra su fecha.
create or replace function private.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'El identificador del perfil no puede cambiar' using errcode = 'RH422';
  end if;

  if (select auth.uid()) is not null then
    if not private.is_admin() then
      raise exception 'Solo un administrador puede modificar perfiles' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      raise exception 'El usuario fue eliminado y no se puede modificar' using errcode = 'RH409';
    end if;
    if new.email is distinct from old.email then
      raise exception 'El correo se gestiona desde Supabase Auth' using errcode = 'RH422';
    end if;
  end if;

  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.role = 'admin' and p.is_active and p.id <> old.id
     ) then
    raise exception 'Debe existir al menos un administrador activo' using errcode = 'RH409';
  end if;

  if new.is_active is distinct from old.is_active then
    new.deactivated_at := case when new.is_active then null else now() end;
  end if;

  return new;
end
$$;

-- Convierte el perfil en registro histórico al borrarse la cuenta de Auth.
-- Quita además las asignaciones vigentes (equipos de vacantes y responsable de
-- evaluación), como hacía antes el borrado en cascada.
create function private.handle_deleted_user()
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

  delete from public.vacancy_members where profile_id = old.id;

  update public.applications
  set assigned_evaluator_id = null
  where assigned_evaluator_id = old.id;

  return old;
end
$$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function private.handle_deleted_user();

-- La cuenta se borra con la Admin API de Auth, que no lleva la sesión del
-- administrador. Esta función se llama antes, con su sesión: comprueba que el
-- usuario esté en la papelera y deja constancia de quién pidió eliminarlo.
create function public.log_user_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'No puede eliminar su propia cuenta' using errcode = 'RH409';
  end if;

  select * into v_profile from public.profiles p where p.id = p_user_id;
  if not found or v_profile.deleted_at is not null then
    raise exception 'Usuario no encontrado' using errcode = 'RH404';
  end if;
  if v_profile.is_active then
    raise exception 'Solo se pueden eliminar usuarios que están en la papelera' using errcode = 'RH409';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'delete_requested',
    'profiles',
    p_user_id::text,
    jsonb_build_object('role', v_profile.role)
  );
end
$$;

revoke all on function public.log_user_deletion(uuid) from public, anon;
grant execute on function public.log_user_deletion(uuid) to authenticated;
