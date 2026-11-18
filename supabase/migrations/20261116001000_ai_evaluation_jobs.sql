-- =============================================================================
-- Cola de evaluaciones con IA (docs/superpowers/specs/2026-11-16-ia-cola-oauth-design.md)
--
-- Una evaluación con IA ya no se ejecuta dentro de la solicitud web: se encola y
-- la procesa un worker externo (ia-worker/) que habla con la app por
-- /api/ia/trabajos/*. El worker solo transporta: la app arma el prompt, valida
-- la respuesta y registra la evaluación con record_evaluation_core.
--
-- 1. ai_evaluation_jobs: un trabajo por solicitud; como máximo uno abierto
--    (pendiente o procesando) por postulación.
-- 2. request_ai_evaluation (personal) y enqueue_system_ai_evaluation (sistema):
--    encolan. El encolado automático no se repite si ya hay una evaluación con
--    IA del mismo CV y la misma versión de criterios.
-- 3. ai_claim_job / ai_start_job / ai_release_job / ai_complete_job: ciclo del
--    worker (solo service_role). Reserva de 10 minutos, máximo 3 intentos; el
--    límite del plan del proveedor y los cambios de datos no cuentan como intento.
--    Cada reserva lleva un token: quien perdió la reserva (venció) ya no puede
--    liberar ni cerrar el trabajo que tomó otro.
-- =============================================================================

create type public.ai_job_status as enum ('pendiente', 'procesando', 'completado', 'error');
-- El orden importa: las solicitudes manuales se atienden antes que las automáticas.
create type public.ai_job_origin as enum ('automatico', 'manual');

create table public.ai_evaluation_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  origin public.ai_job_origin not null,
  status public.ai_job_status not null default 'pendiente',
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  -- No se entrega al worker antes de esta hora (espera por límite o reintento).
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  -- Token de la reserva vigente (null si no está reservado).
  claim_token uuid,
  attempts smallint not null default 0 check (attempts >= 0),
  -- Huella del texto entregado al worker y versión de criterios con que se armó.
  input_sha256 text check (input_sha256 ~ '^[0-9a-f]{64}$'),
  criteria_version integer check (criteria_version > 0),
  evaluation_id uuid references public.candidate_evaluations (id) on delete set null,
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ai_evaluation_jobs_finished_consistency
    check ((status in ('completado', 'error')) = (finished_at is not null))
);

create unique index ai_evaluation_jobs_one_open_idx
  on public.ai_evaluation_jobs (application_id)
  where status in ('pendiente', 'procesando');
create index ai_evaluation_jobs_queue_idx
  on public.ai_evaluation_jobs (origin desc, requested_at)
  where status in ('pendiente', 'procesando');
create index ai_evaluation_jobs_application_idx
  on public.ai_evaluation_jobs (application_id, requested_at desc);

create trigger ai_evaluation_jobs_audit after insert or update or delete on public.ai_evaluation_jobs
  for each row execute function private.audit_row_change();

alter table public.ai_evaluation_jobs enable row level security;

-- Ver: el personal que puede acceder a la postulación. Nadie escribe directo:
-- todo pasa por las funciones de abajo.
create policy ai_evaluation_jobs_select on public.ai_evaluation_jobs
  for select to authenticated
  using (private.is_staff() and private.can_access_application(application_id));

revoke all on table public.ai_evaluation_jobs from anon, authenticated;
grant select on table public.ai_evaluation_jobs to authenticated;

-- -----------------------------------------------------------------------------
-- Encolado
-- -----------------------------------------------------------------------------
create function private.enqueue_ai_evaluation_core(
  p_application_id uuid,
  p_origin public.ai_job_origin,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_vacancy public.vacancies%rowtype;
  v_latest_resume uuid;
  v_job_id uuid;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  select * into v_vacancy from public.vacancies where id = v_app.vacancy_id;
  if v_vacancy.criteria_approved_at is null then
    raise exception 'Los criterios de la vacante no están aprobados' using errcode = 'RH409';
  end if;

  if p_origin = 'automatico' then
    -- No se repite: ya hay una evaluación con IA del CV y los criterios vigentes.
    select e.resume_id into v_latest_resume
    from public.candidate_evaluations e
    where e.id = v_app.latest_evaluation_id;
    if exists (
      select 1
      from public.candidate_evaluations e
      where e.application_id = v_app.id
        and e.method = 'ia'
        and e.criteria_version = v_vacancy.criteria_version
        and e.resume_id is not distinct from v_latest_resume
    ) then
      return null;
    end if;
  end if;

  insert into public.ai_evaluation_jobs (application_id, origin, requested_by)
  values (v_app.id, p_origin, p_actor)
  on conflict (application_id) where status in ('pendiente', 'procesando') do nothing
  returning id into v_job_id;

  if v_job_id is null then
    -- Ya había un trabajo abierto: se devuelve ese. Una solicitud manual
    -- adelanta un trabajo automático que aún espera.
    select id into v_job_id
    from public.ai_evaluation_jobs
    where application_id = v_app.id and status in ('pendiente', 'procesando');
    if p_origin = 'manual' then
      update public.ai_evaluation_jobs
      set origin = 'manual', requested_by = coalesce(requested_by, p_actor), updated_at = now()
      where id = v_job_id and origin = 'automatico';
    end if;
  end if;

  return v_job_id;
end
$$;

revoke all on function private.enqueue_ai_evaluation_core(uuid, public.ai_job_origin, uuid)
  from public, anon, authenticated;

-- Personal: solicitud manual («Evaluar con IA») o automática tras una
-- evaluación del motor hecha por esa persona (sin actor: nadie la pidió).
create function public.request_ai_evaluation(p_application_id uuid, p_automatic boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() or not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return private.enqueue_ai_evaluation_core(
    p_application_id,
    case when p_automatic then 'automatico' else 'manual' end::public.ai_job_origin,
    case when p_automatic then null else (select auth.uid()) end
  );
end
$$;

revoke all on function public.request_ai_evaluation(uuid, boolean) from public, anon;
grant execute on function public.request_ai_evaluation(uuid, boolean) to authenticated;

-- Sistema (formulario público, robot, integraciones): siempre automática.
create function public.enqueue_system_ai_evaluation(p_application_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_ai_evaluation_core(p_application_id, 'automatico', null)
$$;

revoke all on function public.enqueue_system_ai_evaluation(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_system_ai_evaluation(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Ciclo del worker (solo service_role, a través de /api/ia/trabajos/*)
-- -----------------------------------------------------------------------------

-- Reserva el siguiente trabajo disponible por 10 minutos. Primero los manuales.
-- Los que agotaron sus 3 intentos se cierran con error al encontrarlos.
create function public.ai_claim_job()
returns table (job_id uuid, application_id uuid, attempts smallint, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_evaluation_jobs%rowtype;
  v_token uuid := gen_random_uuid();
begin
  loop
    select j.* into v_job
    from public.ai_evaluation_jobs j
    where j.status in ('pendiente', 'procesando')
      and j.available_at <= now()
      and (j.claimed_at is null or j.claimed_at < now() - interval '10 minutes')
    order by j.origin desc, j.requested_at
    limit 1
    for update skip locked;
    if not found then
      return;
    end if;
    exit when v_job.attempts < 3;
    update public.ai_evaluation_jobs
    set status = 'error', error_code = 'demasiados_intentos', claimed_at = null, claim_token = null,
        finished_at = now(), updated_at = now()
    where id = v_job.id;
  end loop;

  update public.ai_evaluation_jobs
  set status = 'procesando', claimed_at = now(), claim_token = v_token, attempts = v_job.attempts + 1,
      input_sha256 = null, criteria_version = null, updated_at = now()
  where id = v_job.id;

  return query select v_job.id, v_job.application_id, (v_job.attempts + 1)::smallint, v_token;
end
$$;

-- Guarda la huella del texto entregado y la versión de criterios usada.
create function public.ai_start_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_input_sha256 text,
  p_criteria_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_evaluation_jobs
  set input_sha256 = p_input_sha256, criteria_version = p_criteria_version, updated_at = now()
  where id = p_job_id and status = 'procesando' and claim_token = p_claim_token;
  if not found then
    raise exception 'Trabajo no encontrado o no reservado' using errcode = 'RH404';
  end if;
end
$$;

-- Devuelve un trabajo reservado a la cola o lo cierra con error:
--   reintentar  → falla transitoria; espera 2 min × intentos. Agotados → error.
--   limite      → el worker no puede usar el proveedor por ahora (límite del plan,
--                 por defecto, o sesión caducada: p_error_code lo indica); espera
--                 hasta p_retry_at (15 min si no se conoce). No cuenta como intento.
--   reprogramar → el CV o los criterios cambiaron; vuelve ya. No cuenta como intento.
--   error       → falla definitiva (p. ej. sin texto legible).
create function public.ai_release_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text default null,
  p_retry_at timestamptz default null
)
returns public.ai_job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_evaluation_jobs%rowtype;
begin
  if p_outcome is null or p_outcome not in ('reintentar', 'limite', 'reprogramar', 'error') then
    raise exception 'Resultado inválido' using errcode = 'RH422';
  end if;
  if p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Código de error inválido' using errcode = 'RH422';
  end if;

  select * into v_job from public.ai_evaluation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'procesando' or v_job.claim_token is distinct from p_claim_token then
    raise exception 'Trabajo no encontrado o no reservado' using errcode = 'RH404';
  end if;

  if p_outcome = 'error' or (p_outcome = 'reintentar' and v_job.attempts >= 3) then
    update public.ai_evaluation_jobs
    set status = 'error', error_code = coalesce(p_error_code, 'error'), claimed_at = null, claim_token = null,
        finished_at = now(), updated_at = now()
    where id = p_job_id;
    return 'error';
  end if;

  update public.ai_evaluation_jobs
  set status = 'pendiente',
      claimed_at = null,
      claim_token = null,
      attempts = case when p_outcome in ('limite', 'reprogramar') then greatest(v_job.attempts - 1, 0) else v_job.attempts end,
      available_at = case p_outcome
        when 'limite' then least(
          greatest(coalesce(p_retry_at, now() + interval '15 minutes'), now() + interval '1 minute'),
          now() + interval '8 days'
        )
        when 'reintentar' then now() + make_interval(mins => 2 * v_job.attempts)
        else now()
      end,
      error_code = case p_outcome
        when 'limite' then coalesce(p_error_code, 'limite_plan')
        when 'reintentar' then coalesce(p_error_code, 'reintento')
        else null
      end,
      updated_at = now()
  where id = p_job_id;
  return 'pendiente';
end
$$;

-- Registra la evaluación del trabajo y lo cierra, en una sola transacción. La
-- huella y la versión de criterios deben coincidir con las de la reserva.
create function public.ai_complete_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_resume_id uuid,
  p_criteria_version integer,
  p_method_version text,
  p_scoring_version text,
  p_model text,
  p_score numeric,
  p_score_potential numeric,
  p_evidence_coverage numeric,
  p_level public.compatibility_level,
  p_summary text,
  p_limitations text[],
  p_input_sha256 text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_evaluation_jobs%rowtype;
  v_eval_id uuid;
begin
  select * into v_job from public.ai_evaluation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'procesando' or v_job.claim_token is distinct from p_claim_token then
    raise exception 'Trabajo no encontrado o no reservado' using errcode = 'RH404';
  end if;
  if v_job.input_sha256 is distinct from p_input_sha256
     or v_job.criteria_version is distinct from p_criteria_version then
    raise exception 'Los datos cambiaron desde que se reservó el trabajo' using errcode = 'RH409';
  end if;

  v_eval_id := private.record_evaluation_core(
    v_job.application_id, p_resume_id, p_criteria_version, 'ia', p_method_version,
    p_scoring_version, p_model, p_score, p_score_potential, p_evidence_coverage, p_level,
    p_summary, p_limitations, p_input_sha256, p_items, v_job.requested_by
  );

  update public.ai_evaluation_jobs
  set status = 'completado', evaluation_id = v_eval_id, error_code = null, claimed_at = null,
      claim_token = null, finished_at = now(), updated_at = now()
  where id = p_job_id;

  return v_eval_id;
end
$$;

revoke all on function public.ai_claim_job() from public, anon, authenticated;
grant execute on function public.ai_claim_job() to service_role;
revoke all on function public.ai_start_job(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_start_job(uuid, uuid, text, integer) to service_role;
revoke all on function public.ai_release_job(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_release_job(uuid, uuid, text, text, timestamptz) to service_role;
revoke all on function public.ai_complete_job(
  uuid, uuid, uuid, integer, text, text, text, numeric, numeric, numeric,
  public.compatibility_level, text, text[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.ai_complete_job(
  uuid, uuid, uuid, integer, text, text, text, numeric, numeric, numeric,
  public.compatibility_level, text, text[], text, jsonb
) to service_role;
