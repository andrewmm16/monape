-- =============================================================================
-- CRM / base de talentos
--
-- Convierte el histórico de candidatos en una base reutilizable:
--  * Etiquetas COMPARTIDAS del equipo (talent_tags) y su asignación a candidatos
--    (candidate_tags), para agrupar ("finalista", "recontratar", "Python senior").
--  * Reactivar: add_candidate_to_vacancy crea una postulación de un candidato del
--    histórico en una vacante nueva, reutilizando su CV vigente, sin duplicar.
--
-- El consentimiento de cartera de talento ya existe (consent_records, propósito
-- 'cartera_talento'); aquí no se toca: la app solo lo muestra como señal.
-- =============================================================================

-- Nuevo origen de postulación: distingue en la bandeja/reportes las que vienen
-- de la base de talentos (reactivadas a mano) del resto.
alter type public.application_intake_method add value if not exists 'cartera';

-- -----------------------------------------------------------------------------
-- 1. Etiquetas compartidas
-- -----------------------------------------------------------------------------
create table public.talent_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- Color opcional para la UI, de una lista fija.
  color text check (color is null or color in ('slate', 'green', 'blue', 'amber', 'red', 'orange')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Único sin distinguir mayúsculas ni espacios al borde.
create unique index talent_tags_name_key on public.talent_tags (lower(btrim(name)));

create trigger talent_tags_set_updated_at before update on public.talent_tags
  for each row execute function private.set_updated_at();
create trigger talent_tags_audit after insert or update or delete on public.talent_tags
  for each row execute function private.audit_row_change();

alter table public.talent_tags enable row level security;

-- Ver: todo el personal. Gestionar: también personal (la acción exige candidates:manage).
create policy talent_tags_select on public.talent_tags
  for select to authenticated using (private.is_staff());
create policy talent_tags_insert on public.talent_tags
  for insert to authenticated with check (private.is_staff());
create policy talent_tags_update on public.talent_tags
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy talent_tags_delete on public.talent_tags
  for delete to authenticated using (private.is_staff());

revoke all on table public.talent_tags from anon, authenticated;
grant select on table public.talent_tags to authenticated;
grant insert (name, color, created_by) on table public.talent_tags to authenticated;
grant update (name, color) on table public.talent_tags to authenticated;
grant delete on table public.talent_tags to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Asignación etiqueta ↔ candidato
-- -----------------------------------------------------------------------------
create table public.candidate_tags (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  tag_id uuid not null references public.talent_tags (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint candidate_tags_unique unique (candidate_id, tag_id)
);

create index candidate_tags_candidate_idx on public.candidate_tags (candidate_id);
create index candidate_tags_tag_idx on public.candidate_tags (tag_id);

create trigger candidate_tags_audit after insert or update or delete on public.candidate_tags
  for each row execute function private.audit_row_change();

alter table public.candidate_tags enable row level security;

create policy candidate_tags_select on public.candidate_tags
  for select to authenticated using (private.is_staff());
create policy candidate_tags_insert on public.candidate_tags
  for insert to authenticated with check (private.is_staff());
create policy candidate_tags_delete on public.candidate_tags
  for delete to authenticated using (private.is_staff());

revoke all on table public.candidate_tags from anon, authenticated;
grant select on table public.candidate_tags to authenticated;
grant insert (candidate_id, tag_id, assigned_by) on table public.candidate_tags to authenticated;
grant delete on table public.candidate_tags to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Reactivar: añadir un candidato del histórico a una vacante nueva
-- Reutiliza el CV vigente del candidato; el trigger applications_check_vacancy
-- valida que la vacante admita postulaciones. No duplica (unique candidato×vacante).
-- -----------------------------------------------------------------------------
create function public.add_candidate_to_vacancy(p_candidate_id uuid, p_vacancy_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resume_id uuid;
  v_application_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.candidates where id = p_candidate_id) then
    raise exception 'El candidato no existe' using errcode = 'RH404';
  end if;
  if exists (
    select 1 from public.applications
    where candidate_id = p_candidate_id and vacancy_id = p_vacancy_id
  ) then
    raise exception 'El candidato ya tiene una postulación en esa vacante' using errcode = 'RH409';
  end if;

  -- CV vigente del candidato (si tiene).
  select id into v_resume_id
  from public.resumes
  where candidate_id = p_candidate_id and is_current = true
  limit 1;

  insert into public.applications (candidate_id, vacancy_id, resume_id, intake_method, created_by)
  values (p_candidate_id, p_vacancy_id, v_resume_id, 'cartera', (select auth.uid()))
  returning id into v_application_id;

  return v_application_id;
end
$$;

revoke all on function public.add_candidate_to_vacancy(uuid, uuid) from public, anon;
grant execute on function public.add_candidate_to_vacancy(uuid, uuid) to authenticated;
