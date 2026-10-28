-- =============================================================================
-- 0006 · Una postulación en proceso por candidato
--
-- Un candidato no puede estar en proceso en dos vacantes a la vez. Una
-- postulación deja de estar en proceso cuando llega a un estado final
-- (seleccionado, no seleccionado, en reserva o retirado) o cuando su vacante se
-- archiva; desde entonces el candidato puede postular a otra vacante.
--
-- La regla se comprueba al registrar una postulación y al reabrir una (pasar
-- de un estado final a uno en proceso). Los cambios entre estados en proceso
-- no se vuelven a comprobar, para que los casos registrados antes de esta
-- migración sigan avanzando hasta cerrarse.
-- =============================================================================

-- Mismos estados que IN_PROCESS_STATUSES en src/modules/applications/schemas.ts.
create function private.is_application_in_process(p_status public.application_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('nuevo', 'en_revision', 'preseleccionado', 'entrevista_programada', 'en_evaluacion')
$$;

create function private.check_one_application_in_process()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy_title text;
begin
  if not private.is_application_in_process(new.status) then
    return new;
  end if;
  if tg_op = 'UPDATE' and private.is_application_in_process(old.status) then
    return new;
  end if;

  -- Serializa las altas y reaperturas del mismo candidato (dos solicitudes
  -- simultáneas no pueden pasar ambas la comprobación).
  perform pg_advisory_xact_lock(hashtextextended('application:' || new.candidate_id::text, 0));

  select v.title
  into v_vacancy_title
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id
  where a.candidate_id = new.candidate_id
    and a.id <> new.id
    and v.status <> 'archivada'
    and private.is_application_in_process(a.status)
  order by a.applied_at
  limit 1;

  if found then
    raise exception 'El candidato ya está en proceso en la vacante «%». Solo puede tener una postulación en proceso a la vez', v_vacancy_title
      using errcode = 'RH409';
  end if;
  return new;
end
$$;

create trigger applications_one_in_process
  before insert or update of status on public.applications
  for each row execute function private.check_one_application_in_process();

revoke all on function private.is_application_in_process(public.application_status) from public;
grant execute on function private.is_application_in_process(public.application_status) to authenticated, service_role;

-- La ficha del candidato necesita saber si la vacante está archivada para
-- mostrar si puede postular a otra. Se añade la columna al final de la vista.
create or replace view public.application_overview
with (security_invoker = true)
as
select
  a.id,
  a.vacancy_id,
  a.candidate_id,
  a.status,
  a.applied_at,
  a.status_changed_at,
  a.assigned_evaluator_id,
  ev.full_name as assigned_evaluator_name,
  c.full_name as candidate_name,
  c.email as candidate_email,
  v.title as vacancy_title,
  v.criteria_version as vacancy_criteria_version,
  (v.criteria_approved_at is null) as criteria_pending_approval,
  e.id as evaluation_id,
  e.score,
  e.score_potential,
  e.evidence_coverage,
  e.level,
  e.method as evaluation_method,
  e.review_status,
  e.created_at as evaluated_at,
  e.criteria_version as evaluation_criteria_version,
  coalesce(e.criteria_version < v.criteria_version, false) as evaluation_outdated,
  coalesce(m.top_met, '{}') as top_met,
  coalesce(m.top_gaps, '{}') as top_gaps,
  coalesce(m.top_pending, '{}') as top_pending,
  v.status as vacancy_status
from public.applications a
join public.candidates c on c.id = a.candidate_id
join public.vacancies v on v.id = a.vacancy_id
left join public.profiles ev on ev.id = a.assigned_evaluator_id
left join public.candidate_evaluations e on e.id = a.latest_evaluation_id
left join lateral (
  select
    (array_agg(i.description order by i.weight desc, i.position)
      filter (where i.assessment = 'acreditado'))[1:3] as top_met,
    (array_agg(i.description order by i.weight desc, i.position)
      filter (where i.assessment in ('no_cumplido', 'sin_evidencia')))[1:3] as top_gaps,
    (array_agg(i.description order by i.weight desc, i.position)
      filter (where i.assessment = 'pendiente_verificacion'))[1:3] as top_pending
  from public.candidate_evaluation_items i
  where i.evaluation_id = e.id
) m on true;
