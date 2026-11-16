-- =============================================================================
-- 0021 · Acceso del rol reclutador_caleta (acotado)
--
-- El reclutador_caleta solo trabaja el Reclutador Caleta: ve las vacantes y sus
-- requisitos (para elegir puesto y puntuar) y gestiona sus prospectos. NO ve
-- candidatos, postulaciones ni evaluaciones (esas políticas usan is_staff() /
-- can_access_vacancy(), que no se tocan), y no deriva prospectos a candidatos
-- (crear candidatos exige is_staff()). La eliminación de prospectos sigue siendo
-- solo de administradores.
-- =============================================================================

create function private.is_caleta_recruiter()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role()::text = 'reclutador_caleta', false)
$$;

revoke all on function private.is_caleta_recruiter() from public;
grant execute on function private.is_caleta_recruiter() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Prospectos: ver, crear y actualizar (eliminar sigue siendo solo admin).
-- Políticas adicionales (permisivas, se suman por OR a las de is_staff()).
-- -----------------------------------------------------------------------------
create policy caleta_prospects_select_recruiter on public.caleta_prospects
  for select to authenticated using (private.is_caleta_recruiter());
create policy caleta_prospects_insert_recruiter on public.caleta_prospects
  for insert to authenticated with check (private.is_caleta_recruiter());
create policy caleta_prospects_update_recruiter on public.caleta_prospects
  for update to authenticated using (private.is_caleta_recruiter()) with check (private.is_caleta_recruiter());

-- -----------------------------------------------------------------------------
-- Lectura de vacantes y sus requisitos (solo para elegir el puesto y puntuar).
-- No abre postulaciones: applications_select usa can_access_vacancy(), intacta.
-- -----------------------------------------------------------------------------
create policy vacancies_select_caleta on public.vacancies
  for select to authenticated using (private.is_caleta_recruiter());
create policy vacancy_requirements_select_caleta on public.vacancy_requirements
  for select to authenticated using (private.is_caleta_recruiter());

-- -----------------------------------------------------------------------------
-- Alta de perfiles: aceptar también 'reclutador_caleta' desde app_metadata.
-- (Mismo cuerpo que 0010, con el rol añadido al allowlist.)
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  if new.raw_app_meta_data ->> 'role' in ('admin', 'rrhh', 'reclutador_caleta') then
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
