-- =============================================================================
-- 2.9 · Páginas públicas de vacantes, datos para Google y feed de empleo
--
-- Agrega a `vacancies` los datos de publicación (ubicación, tipo de empleo,
-- sueldo, confidencialidad), un código público inmutable y tres funciones de
-- lectura que SOLO puede ejecutar `service_role`: el rol `anon` sigue sin
-- ningún privilegio y la parte pública se sirve desde el servidor de la
-- aplicación con una lista cerrada de columnas.
-- =============================================================================

create type public.employment_type as enum (
  'tiempo_completo',
  'medio_tiempo',
  'temporal',
  'practicas',
  'por_proyecto'
);

create type public.salary_period as enum ('hora', 'dia', 'semana', 'mes', 'anio');

alter table public.vacancies
  add column city text check (char_length(city) <= 100),
  add column region text check (char_length(region) <= 100),
  add column employment_type public.employment_type,
  add column salary_min numeric(12, 2) check (salary_min >= 0),
  add column salary_max numeric(12, 2) check (salary_max >= 0),
  add column salary_currency text check (salary_currency in ('PEN', 'USD')),
  add column salary_period public.salary_period,
  add column is_confidential boolean not null default false,
  -- Los dos siguientes los fija el disparador al publicar por primera vez.
  add column public_code text unique check (public_code ~ '^[a-z0-9]{10}$'),
  add column first_published_at timestamptz,
  -- Sin sueldo no hay moneda ni periodo; con sueldo se exigen ambos. Se admite
  -- solo el mínimo (monto fijo), nunca solo el máximo.
  add constraint vacancies_salary_check check (
    (salary_min is null and salary_max is null and salary_currency is null and salary_period is null)
    or (
      salary_min is not null
      and salary_currency is not null
      and salary_period is not null
      and (salary_max is null or salary_max >= salary_min)
    )
  );

-- El personal edita los datos de publicación; el código público y la fecha de
-- primera publicación quedan fuera de todo permiso de escritura.
grant insert (
  city, region, employment_type, salary_min, salary_max, salary_currency,
  salary_period, is_confidential
) on table public.vacancies to authenticated;
grant update (
  city, region, employment_type, salary_min, salary_max, salary_currency,
  salary_period, is_confidential
) on table public.vacancies to authenticated;

-- -----------------------------------------------------------------------------
-- ¿La vacante tiene los datos exigidos para salir en Google y en el feed?
-- Descripción de al menos 50 caracteres (Talent.com), tipo de empleo y, salvo
-- que sea remota, ciudad y región.
-- -----------------------------------------------------------------------------
create function private.vacancy_has_public_data(v public.vacancies)
returns boolean
language sql
stable
set search_path = ''
as $$
  select char_length(btrim(v.description)) >= 50
    and v.employment_type is not null
    and (
      v.modality = 'remoto'
      or (btrim(coalesce(v.city, '')) <> '' and btrim(coalesce(v.region, '')) <> '')
    )
$$;

revoke all on function private.vacancy_has_public_data(public.vacancies) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Al publicar: valida los datos (vacantes no confidenciales, solicitudes de
-- usuarios) y fija el código público y la fecha de primera publicación. Ambos
-- se conservan siempre: ninguna escritura puede cambiarlos.
-- -----------------------------------------------------------------------------
create function private.vacancy_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
  v_code text;
begin
  if tg_op = 'INSERT' then
    new.public_code := null;
    new.first_published_at := null;
  else
    new.public_code := old.public_code;
    new.first_published_at := old.first_published_at;
  end if;

  if new.status <> 'publicada' or (tg_op = 'UPDATE' and old.status = 'publicada') then
    return new;
  end if;

  -- Como el resto de reglas de ciclo de vida, solo se exige a usuarios: las
  -- cargas de servicio (migraciones, datos ficticios) no pasan por aquí.
  if (select auth.uid()) is not null and not new.is_confidential then
    if char_length(btrim(new.description)) < 50 then
      v_missing := array_append(v_missing, 'una descripción de al menos 50 caracteres');
    end if;
    if new.employment_type is null then
      v_missing := array_append(v_missing, 'el tipo de empleo');
    end if;
    if new.modality is distinct from 'remoto'
       and (btrim(coalesce(new.city, '')) = '' or btrim(coalesce(new.region, '')) = '') then
      v_missing := array_append(v_missing, 'la ciudad y la región');
    end if;
    if cardinality(v_missing) > 0 then
      raise exception 'Para publicar la vacante se necesita: %. También puede marcarla como confidencial.',
        array_to_string(v_missing, ', ')
        using errcode = 'RH422';
    end if;
  end if;

  if new.public_code is null then
    loop
      v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      exit when not exists (select 1 from public.vacancies where public_code = v_code);
    end loop;
    new.public_code := v_code;
  end if;
  if new.first_published_at is null then
    new.first_published_at := now();
  end if;
  return new;
end
$$;

revoke all on function private.vacancy_publication() from public, anon, authenticated;

-- Se ejecuta después de `vacancies_guard_status` (orden alfabético) para que
-- un cambio de estado inválido informe primero su propio error.
create trigger vacancies_publication
  before insert or update on public.vacancies
  for each row execute function private.vacancy_publication();

-- -----------------------------------------------------------------------------
-- Lectura pública. Solo `service_role`; lista cerrada de columnas; nunca
-- criterios, pesos, términos de búsqueda, responsable ni postulaciones.
-- Fecha de cierre sin vencer según la hora de Lima.
-- -----------------------------------------------------------------------------
create function public.public_vacancies()
returns table (
  code text,
  title text,
  department text,
  description text,
  responsibilities text,
  city text,
  region text,
  modality public.work_modality,
  employment_type public.employment_type,
  contract_type text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period public.salary_period,
  first_published_at timestamptz,
  closing_date date,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.public_code, v.title, v.department, v.description, v.responsibilities,
         v.city, v.region, v.modality, v.employment_type, v.contract_type,
         v.salary_min, v.salary_max, v.salary_currency, v.salary_period,
         v.first_published_at, v.closing_date, v.updated_at
    from public.vacancies v
   where v.status = 'publicada'
     and not v.is_confidential
     and v.public_code is not null
     and v.first_published_at is not null
     and private.vacancy_has_public_data(v)
     and (v.closing_date is null or v.closing_date >= (now() at time zone 'America/Lima')::date)
   order by v.first_published_at desc, v.public_code
$$;

create function public.public_vacancy(p_code text)
returns table (
  code text,
  title text,
  department text,
  description text,
  responsibilities text,
  city text,
  region text,
  modality public.work_modality,
  employment_type public.employment_type,
  contract_type text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period public.salary_period,
  first_published_at timestamptz,
  closing_date date,
  updated_at timestamptz,
  accepting_applications boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.public_code, v.title, v.department, v.description, v.responsibilities,
         v.city, v.region, v.modality, v.employment_type, v.contract_type,
         v.salary_min, v.salary_max, v.salary_currency, v.salary_period,
         v.first_published_at, v.closing_date, v.updated_at,
         (v.status = 'publicada'
           and (v.closing_date is null or v.closing_date >= (now() at time zone 'America/Lima')::date))
    from public.vacancies v
   where v.public_code = p_code
     and v.first_published_at is not null
     and not v.is_confidential
     and (v.status = 'cerrada' or (v.status = 'publicada' and private.vacancy_has_public_data(v)))
$$;

create function public.public_vacancy_requirements(p_code text)
returns table (
  description text,
  priority public.requirement_priority
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.description, r.priority
    from public.vacancies v
    join public.vacancy_requirements r on r.vacancy_id = v.id
   where v.public_code = p_code
     and v.first_published_at is not null
     and not v.is_confidential
     and (v.status = 'cerrada' or (v.status = 'publicada' and private.vacancy_has_public_data(v)))
   order by r.position, r.created_at
$$;

revoke all on function public.public_vacancies() from public, anon, authenticated;
revoke all on function public.public_vacancy(text) from public, anon, authenticated;
revoke all on function public.public_vacancy_requirements(text) from public, anon, authenticated;
grant execute on function public.public_vacancies() to service_role;
grant execute on function public.public_vacancy(text) to service_role;
grant execute on function public.public_vacancy_requirements(text) to service_role;
