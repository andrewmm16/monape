-- =============================================================================
-- 0002 · Vacantes, requisitos ponderados y equipo evaluador
-- =============================================================================

create type public.vacancy_status as enum ('borrador', 'publicada', 'cerrada', 'archivada');
create type public.work_modality as enum ('presencial', 'remoto', 'hibrido');
create type public.requirement_category as enum (
  'formacion',
  'experiencia',
  'habilidad_tecnica',
  'herramienta',
  'certificacion',
  'competencia',
  'idioma',
  'otro'
);
create type public.requirement_priority as enum ('obligatorio', 'deseable');

create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 200),
  department text not null check (char_length(department) between 2 and 120),
  description text not null default '' check (char_length(description) <= 10000),
  responsibilities text not null default '' check (char_length(responsibilities) <= 10000),
  location text check (char_length(location) <= 200),
  modality public.work_modality,
  contract_type text check (char_length(contract_type) <= 120),
  opening_date date,
  closing_date date,
  owner_id uuid references public.profiles (id) on delete set null,
  status public.vacancy_status not null default 'borrador',
  -- Versión de criterios: se incrementa en cada aprobación. Cualquier cambio en
  -- los requisitos anula la aprobación vigente hasta que RRHH la renueve.
  criteria_version integer not null default 0 check (criteria_version >= 0),
  criteria_approved_at timestamptz,
  criteria_approved_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacancies_dates_check
    check (closing_date is null or opening_date is null or closing_date >= opening_date)
);

create index vacancies_status_idx on public.vacancies (status);
create index vacancies_owner_idx on public.vacancies (owner_id);

create table public.vacancy_requirements (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  category public.requirement_category not null,
  priority public.requirement_priority not null,
  description text not null check (char_length(description) between 2 and 500),
  -- Términos de búsqueda (sinónimos, siglas) que usa el motor de reglas.
  keywords text[] not null default '{}' check (cardinality(keywords) <= 20),
  -- Peso relativo (1-10). El porcentaje efectivo se calcula sobre la suma.
  weight smallint not null check (weight between 1 and 10),
  min_years numeric(4, 1) check (min_years is null or (min_years >= 0 and min_years <= 50)),
  -- Requisito legal o esencial: siempre exige verificación humana.
  is_essential boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vacancy_requirements_vacancy_idx on public.vacancy_requirements (vacancy_id, position);

create table public.vacancy_members (
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (vacancy_id, profile_id)
);

create index vacancy_members_profile_idx on public.vacancy_members (profile_id);

-- -----------------------------------------------------------------------------
-- Acceso a vacantes: RRHH y administradores ven todas; los evaluadores, solo
-- aquellas en las que fueron incluidos.
-- -----------------------------------------------------------------------------
create function private.can_access_vacancy(p_vacancy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff() or (
    private.is_active_user() and exists (
      select 1
      from public.vacancy_members m
      where m.vacancy_id = p_vacancy_id
        and m.profile_id = (select auth.uid())
    )
  )
$$;

revoke all on function private.can_access_vacancy(uuid) from public;
grant execute on function private.can_access_vacancy(uuid) to authenticated, service_role;

-- Cualquier cambio en requisitos invalida la aprobación de criterios.
create function private.reset_criteria_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy_id uuid;
begin
  if tg_op = 'DELETE' then
    v_vacancy_id := old.vacancy_id;
  else
    v_vacancy_id := new.vacancy_id;
  end if;

  update public.vacancies
  set criteria_approved_at = null,
      criteria_approved_by = null
  where id = v_vacancy_id
    and criteria_approved_at is not null;

  return null;
end
$$;

create trigger vacancy_requirements_reset_approval
  after insert or update or delete on public.vacancy_requirements
  for each row execute function private.reset_criteria_approval();

-- Aprobación de criterios por RRHH: incrementa la versión de criterios.
create function public.approve_vacancy_criteria(p_vacancy_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  perform 1 from public.vacancies where id = p_vacancy_id for update;
  if not found then
    raise exception 'Vacante no encontrada' using errcode = 'RH404';
  end if;
  if exists (select 1 from public.vacancies where id = p_vacancy_id and status = 'archivada') then
    raise exception 'La vacante está archivada' using errcode = 'RH409';
  end if;

  if not exists (select 1 from public.vacancy_requirements where vacancy_id = p_vacancy_id) then
    raise exception 'La vacante no tiene requisitos definidos' using errcode = 'RH422';
  end if;

  update public.vacancies
  set criteria_version = criteria_version + 1,
      criteria_approved_at = now(),
      criteria_approved_by = (select auth.uid())
  where id = p_vacancy_id
    and criteria_approved_at is null
  returning criteria_version into v_version;

  if v_version is null then
    raise exception 'Los criterios ya están aprobados' using errcode = 'RH409';
  end if;

  return v_version;
end
$$;

revoke all on function public.approve_vacancy_criteria(uuid) from public, anon;
grant execute on function public.approve_vacancy_criteria(uuid) to authenticated;

-- Ciclo de vida de la vacante (mismas reglas que VACANCY_TRANSITIONS en
-- src/modules/vacancies/schemas.ts). Las vacantes nuevas nacen en borrador.
-- Solo se aplica a solicitudes de usuarios (no a migraciones ni procesos de
-- servicio sin JWT).
create function private.guard_vacancy_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'borrador' then
      raise exception 'Las vacantes se crean en borrador' using errcode = 'RH422';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'borrador' and new.status in ('publicada', 'archivada'))
    or (old.status = 'publicada' and new.status = 'cerrada')
    or (old.status = 'cerrada' and new.status in ('publicada', 'archivada'))
  ) then
    raise exception 'Ese cambio de estado no está permitido para la vacante' using errcode = 'RH409';
  end if;
  return new;
end
$$;

create trigger vacancies_guard_status
  before insert or update on public.vacancies
  for each row execute function private.guard_vacancy_status();

-- -----------------------------------------------------------------------------
-- Disparadores
-- -----------------------------------------------------------------------------
create trigger vacancies_set_updated_at
  before update on public.vacancies
  for each row execute function private.set_updated_at();

create trigger vacancies_set_created_by
  before insert on public.vacancies
  for each row execute function private.set_actor_column('created_by');

create trigger vacancy_requirements_set_updated_at
  before update on public.vacancy_requirements
  for each row execute function private.set_updated_at();

create trigger vacancy_members_set_added_by
  before insert on public.vacancy_members
  for each row execute function private.set_actor_column('added_by');

create trigger vacancies_audit
  after insert or update or delete on public.vacancies
  for each row execute function private.audit_row_change();

create trigger vacancy_requirements_audit
  after insert or update or delete on public.vacancy_requirements
  for each row execute function private.audit_row_change();

create trigger vacancy_members_audit
  after insert or delete on public.vacancy_members
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
alter table public.vacancies enable row level security;
alter table public.vacancy_requirements enable row level security;
alter table public.vacancy_members enable row level security;

create policy vacancies_select on public.vacancies
  for select to authenticated
  using (private.can_access_vacancy(id));

create policy vacancies_insert on public.vacancies
  for insert to authenticated
  with check (private.is_staff());

create policy vacancies_update on public.vacancies
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff());

-- Solo se eliminan borradores; el resto se archiva para conservar trazabilidad.
create policy vacancies_delete on public.vacancies
  for delete to authenticated
  using (private.is_admin() and status = 'borrador');

create policy vacancy_requirements_select on public.vacancy_requirements
  for select to authenticated
  using (private.can_access_vacancy(vacancy_id));

create policy vacancy_requirements_insert on public.vacancy_requirements
  for insert to authenticated
  with check (private.is_staff());

create policy vacancy_requirements_update on public.vacancy_requirements
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff());

create policy vacancy_requirements_delete on public.vacancy_requirements
  for delete to authenticated
  using (private.is_staff());

create policy vacancy_members_select on public.vacancy_members
  for select to authenticated
  using (private.is_staff() or (private.is_active_user() and profile_id = (select auth.uid())));

create policy vacancy_members_insert on public.vacancy_members
  for insert to authenticated
  with check (private.is_staff());

create policy vacancy_members_delete on public.vacancy_members
  for delete to authenticated
  using (private.is_staff());

revoke all on table public.vacancies from anon, authenticated;
grant select, delete on table public.vacancies to authenticated;
grant insert (
  title, department, description, responsibilities, location, modality,
  contract_type, opening_date, closing_date, owner_id, status
) on table public.vacancies to authenticated;
grant update (
  title, department, description, responsibilities, location, modality,
  contract_type, opening_date, closing_date, owner_id, status
) on table public.vacancies to authenticated;

revoke all on table public.vacancy_requirements from anon, authenticated;
grant select, delete on table public.vacancy_requirements to authenticated;
grant insert (
  vacancy_id, category, priority, description, keywords, weight, min_years, is_essential, position
) on table public.vacancy_requirements to authenticated;
grant update (
  category, priority, description, keywords, weight, min_years, is_essential, position
) on table public.vacancy_requirements to authenticated;

revoke all on table public.vacancy_members from anon, authenticated;
grant select, delete on table public.vacancy_members to authenticated;
grant insert (vacancy_id, profile_id) on table public.vacancy_members to authenticated;
