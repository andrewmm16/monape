-- =============================================================================
-- 0001 · Fundamentos
-- Roles de aplicación, perfiles internos, funciones de autorización,
-- auditoría y límites de solicitudes.
--
-- Convenciones:
--   * Toda tabla expuesta tiene RLS habilitado y privilegios explícitos.
--   * Las funciones auxiliares de autorización viven en el esquema `private`,
--     que no se expone en la API de datos.
--   * Códigos SQLSTATE propios: RH404 (no encontrado), RH409 (estado no
--     válido), RH422 (regla de negocio). 42501 = permiso denegado.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('admin', 'rrhh', 'evaluador');

-- -----------------------------------------------------------------------------
-- Perfiles de usuarios internos
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  email text not null check (char_length(email) <= 254),
  role public.app_role not null default 'evaluador',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Usuarios internos. Se crea automáticamente cuando un administrador invita a un usuario en Supabase Auth.';

-- -----------------------------------------------------------------------------
-- Funciones auxiliares de autorización (SECURITY DEFINER: leen profiles sin
-- quedar sujetas a RLS y evitan recursión en las políticas)
-- -----------------------------------------------------------------------------
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

create function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_role() is not null
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() in ('admin', 'rrhh'), false)
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'admin', false)
$$;

create function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception
  when others then
    return null;
end
$$;

-- -----------------------------------------------------------------------------
-- Disparadores genéricos
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Asigna el usuario autenticado a la columna indicada en TG_ARGV[0]
-- (created_by, uploaded_by, added_by, actor_id...). Impide suplantar al autor.
create function private.set_actor_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], (select auth.uid())));
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Alta automática de perfiles desde Supabase Auth.
-- El rol solo se toma de app_metadata (únicamente modificable con la clave de
-- servicio); por defecto, el rol con menos privilegios.
-- -----------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := 'evaluador';
begin
  if new.raw_app_meta_data ->> 'role' in ('admin', 'rrhh', 'evaluador') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.app_role;
  end if;

  insert into public.profiles (id, full_name, email, role)
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
    v_role
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = coalesce(new.email, '')
  where id = new.id;
  return new;
end
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.sync_profile_email();

-- Reglas de integridad de perfiles: solo administradores modifican perfiles y
-- siempre debe quedar al menos un administrador activo.
create function private.guard_profile_update()
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

  return new;
end
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (private.is_active_user() or id = (select auth.uid()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, role, is_active) on table public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoría. Nunca guarda contenido de CV, tokens ni valores de datos
-- personales: solo qué entidad cambió, quién y qué campos.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null check (char_length(action) between 1 and 64),
  entity_type text not null check (char_length(entity_type) between 1 and 64),
  entity_id text check (char_length(entity_id) <= 64),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create function private.prevent_audit_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los registros de auditoría no se pueden modificar' using errcode = '42501';
end
$$;

create trigger audit_logs_immutable
  before update on public.audit_logs
  for each row execute function private.prevent_audit_update();

alter table public.audit_logs enable row level security;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (private.is_admin());

revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

-- Disparador genérico de auditoría. Registra nombres de campos modificados y,
-- solo para columnas de estado no sensibles, los valores anterior y nuevo.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_meta jsonb := '{}'::jsonb;
  v_tracked constant text[] := array[
    'status', 'role', 'is_active', 'criteria_version', 'review_status',
    'review_outcome', 'is_current', 'origin', 'assigned_evaluator_id', 'profile_id'
  ];
  k text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;

    select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at'
      and n.value is distinct from (v_old -> n.key);

    if cardinality(v_changed) = 0 then
      return null;
    end if;

    v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
    foreach k in array v_tracked loop
      if k = any (v_changed) then
        v_meta := v_meta || jsonb_build_object(
          k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k)
        );
      end if;
    end loop;
  end if;

  if tg_op <> 'UPDATE' then
    foreach k in array v_tracked loop
      if v_row ? k then
        v_meta := v_meta || jsonb_build_object(k, v_row -> k);
      end if;
    end loop;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'vacancy_id'),
    v_meta
  );
  return null;
end
$$;

create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change();

-- Las lecturas sensibles (descarga de CV) se registran con funciones
-- específicas que validan el acceso (ver log_resume_download en 0003).

-- -----------------------------------------------------------------------------
-- Límite de solicitudes por usuario (ventana fija). Persistente en la base de
-- datos para funcionar con instancias serverless. Los límites de cada tipo de
-- operación se definen aquí: quien llama solo indica la operación.
-- -----------------------------------------------------------------------------
create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  request_count integer not null
);

create function public.consume_rate_limit(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_window interval;
  v_key text;
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  select l.max_requests, l.window_length
  into v_max, v_window
  from (values
    ('cv_upload', 20, interval '10 minutes'),
    ('cv_download', 60, interval '10 minutes'),
    ('evaluation', 30, interval '10 minutes'),
    ('ai_evaluation', 10, interval '10 minutes'),
    ('user_invite', 10, interval '1 hour')
  ) as l(bucket, max_requests, window_length)
  where l.bucket = p_bucket;

  if v_max is null then
    raise exception 'Tipo de operación desconocido' using errcode = 'RH422';
  end if;

  v_key := (select auth.uid())::text || ':' || p_bucket;

  insert into private.rate_limits as r (key, window_start, request_count)
  values (v_key, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - v_window then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - v_window then v_now
          else r.window_start
        end
  returning request_count into v_count;

  return v_count <= v_max;
end
$$;

-- -----------------------------------------------------------------------------
-- Privilegios de funciones
-- -----------------------------------------------------------------------------
revoke all on function private.current_app_role() from public;
revoke all on function private.is_active_user() from public;
revoke all on function private.is_staff() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.try_uuid(text) from public;
grant execute on function private.current_app_role() to authenticated, service_role;
grant execute on function private.is_active_user() to authenticated, service_role;
grant execute on function private.is_staff() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.try_uuid(text) to authenticated, service_role;

revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;
