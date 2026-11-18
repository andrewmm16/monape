-- =============================================================================
-- Estado del worker de IA (ia-worker/)
--
-- Una sola fila con el último contacto del worker y si está pausado (límite del
-- plan, sesión de Claude inválida o CLI no disponible). Sirve para que RRHH vea
-- «servicio de IA desconectado / en pausa» en vez de una cola que no avanza, y
-- para avisar a administración cuando hay que renovar el token.
--
-- Se actualiza cada pocos segundos (cada reclamo del worker): sin auditoría por
-- fila, a propósito. Solo la escribe service_role (API /api/ia/*).
-- =============================================================================

create table public.ai_worker_status (
  id boolean primary key default true check (id),
  state text not null check (state in ('activo', 'pausado')),
  pause_reason text check (pause_reason in ('limite_plan', 'sin_sesion', 'worker_no_disponible')),
  paused_until timestamptz,
  last_seen_at timestamptz not null,
  -- Desde cuándo está en el estado (y motivo) actual.
  state_since timestamptz not null,
  cli_version text check (char_length(cli_version) <= 100),
  constraint ai_worker_status_reason_consistency check ((state = 'pausado') = (pause_reason is not null))
);

alter table public.ai_worker_status enable row level security;

create policy ai_worker_status_select on public.ai_worker_status
  for select to authenticated
  using (private.is_staff());

revoke all on table public.ai_worker_status from anon, authenticated;
grant select on table public.ai_worker_status to authenticated;

-- Registra un latido. Devuelve true si cambió el estado o el motivo de pausa
-- (para avisar una sola vez por transición, no en cada latido).
create function public.ai_worker_heartbeat(
  p_state text,
  p_reason text default null,
  p_until timestamptz default null,
  p_cli_version text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev public.ai_worker_status%rowtype;
  v_changed boolean;
begin
  if p_state is null or p_state not in ('activo', 'pausado') then
    raise exception 'Estado inválido' using errcode = 'RH422';
  end if;
  if (p_state = 'pausado') <> (p_reason is not null)
     or (p_reason is not null and p_reason not in ('limite_plan', 'sin_sesion', 'worker_no_disponible')) then
    raise exception 'Motivo de pausa inválido' using errcode = 'RH422';
  end if;

  select * into v_prev from public.ai_worker_status where id for update;
  v_changed := not found or v_prev.state <> p_state or v_prev.pause_reason is distinct from p_reason;

  insert into public.ai_worker_status as s (id, state, pause_reason, paused_until, last_seen_at, state_since, cli_version)
  values (true, p_state, p_reason, case when p_state = 'pausado' then p_until end, now(), now(), left(p_cli_version, 100))
  on conflict (id) do update
  set state = excluded.state,
      pause_reason = excluded.pause_reason,
      paused_until = excluded.paused_until,
      last_seen_at = excluded.last_seen_at,
      state_since = case when v_changed then now() else s.state_since end,
      cli_version = coalesce(excluded.cli_version, s.cli_version);

  return v_changed;
end
$$;

revoke all on function public.ai_worker_heartbeat(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.ai_worker_heartbeat(text, text, timestamptz, text) to service_role;
