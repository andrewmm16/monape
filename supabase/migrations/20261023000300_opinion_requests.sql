-- =============================================================================
-- 0008 · Pedir opinión y notificaciones
--
-- El «responsable de evaluación» pasa a ser la persona a la que RRHH le pide
-- su opinión sobre una postulación (applications.assigned_evaluator_id). Al
-- pedirla, esa persona recibe una notificación. Cuando registra una
-- observación en la postulación, la solicitud queda respondida y quien la pidió
-- recibe otra notificación.
--
-- La solicitud solo se hace con public.request_opinion: ya no se puede
-- escribir assigned_evaluator_id directamente.
-- =============================================================================

alter table public.applications
  add column opinion_requested_at timestamptz,
  add column opinion_requested_by uuid references public.profiles (id) on delete set null,
  add column opinion_answered_at timestamptz;

comment on column public.applications.assigned_evaluator_id is
  'Persona a la que RRHH pidió su opinión sobre la postulación.';

-- Asignaciones anteriores a esta migración: se conservan como solicitudes
-- pendientes, sin notificación.
update public.applications
set opinion_requested_at = updated_at
where assigned_evaluator_id is not null;

alter table public.applications
  add constraint applications_opinion_request_check
    check (assigned_evaluator_id is not null or (opinion_requested_at is null and opinion_answered_at is null));

-- Al quitar a la persona (también al eliminar su cuenta), la solicitud desaparece.
create function private.clear_opinion_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_evaluator_id is null then
    new.opinion_requested_at := null;
    new.opinion_requested_by := null;
    new.opinion_answered_at := null;
  end if;
  return new;
end
$$;

create trigger applications_clear_opinion_request
  before update of assigned_evaluator_id on public.applications
  for each row execute function private.clear_opinion_request();

revoke insert (assigned_evaluator_id) on table public.applications from authenticated;
revoke update (assigned_evaluator_id) on table public.applications from authenticated;

-- -----------------------------------------------------------------------------
-- Notificaciones (solo las lee y marca como leídas su destinatario)
-- -----------------------------------------------------------------------------
create type public.notification_kind as enum ('opinion_solicitada', 'opinion_respondida');

create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  application_id uuid not null references public.applications (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_read_after_created check (read_at is null or read_at >= created_at)
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()) and private.is_active_user());
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()) and private.is_active_user())
  with check (recipient_id = (select auth.uid()));

revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Pedir opinión (p_profile_id nulo: retirar la solicitud)
-- -----------------------------------------------------------------------------
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

revoke all on function public.request_opinion(uuid, uuid) from public, anon;
grant execute on function public.request_opinion(uuid, uuid) to authenticated;

-- Una observación de la persona consultada responde la solicitud.
create function private.resolve_opinion_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester uuid;
begin
  update public.applications a
  set opinion_answered_at = now()
  where a.id = new.application_id
    and a.assigned_evaluator_id = new.actor_id
    and a.opinion_requested_at is not null
    and a.opinion_answered_at is null
  returning a.opinion_requested_by into v_requester;

  if not found then
    return null;
  end if;

  update public.notifications n
  set read_at = now()
  where n.application_id = new.application_id
    and n.recipient_id = new.actor_id
    and n.kind = 'opinion_solicitada'
    and n.read_at is null;

  if v_requester is not null and v_requester <> new.actor_id then
    insert into public.notifications (recipient_id, kind, application_id, actor_id)
    values (v_requester, 'opinion_respondida', new.application_id, new.actor_id);
  end if;
  return null;
end
$$;

create trigger application_events_resolve_opinion
  after insert on public.application_events
  for each row
  when (new.event_type = 'observacion')
  execute function private.resolve_opinion_request();

-- -----------------------------------------------------------------------------
-- Vista de candidatos por vacante: estado de la solicitud de opinión
-- -----------------------------------------------------------------------------
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
  v.status as vacancy_status,
  a.opinion_requested_at,
  a.opinion_answered_at
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
