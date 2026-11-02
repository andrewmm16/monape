-- =============================================================================
-- Estado del robot de portales
--
-- El robot avisa en cada ciclo que sigue funcionando y, cuando se detiene
-- porque necesita a una persona (CAPTCHA, código de verificación, sesión
-- vencida), lo dice. La app lo muestra a RRHH.
--
-- * bot_status: una fila por portal con el último estado informado.
-- * bot_report_status: solo service_role.
-- =============================================================================

create table public.bot_status (
  portal_id uuid primary key references public.job_portals (id) on delete cascade,
  state text not null check (state in ('activo', 'necesita_persona')),
  -- Código corto de la causa; nunca texto libre ni datos personales.
  reason text check (reason ~ '^[a-z0-9_]{1,64}$'),
  seen_at timestamptz not null default now()
);

alter table public.bot_status enable row level security;

create policy bot_status_select on public.bot_status
  for select to authenticated using (private.is_staff());

revoke all on table public.bot_status from anon, authenticated;
grant select on table public.bot_status to authenticated;

create function public.bot_report_status(p_portal_id uuid, p_state text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state not in ('activo', 'necesita_persona') or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,64}$') then
    raise exception 'Estado no válido' using errcode = 'RH422';
  end if;
  if not exists (select 1 from public.job_portals where id = p_portal_id and bot_enabled) then
    raise exception 'El portal no existe o no admite al robot' using errcode = 'RH404';
  end if;

  insert into public.bot_status (portal_id, state, reason, seen_at)
  values (p_portal_id, p_state, case when p_state = 'activo' then null else p_reason end, now())
  on conflict (portal_id) do update
    set state = excluded.state, reason = excluded.reason, seen_at = excluded.seen_at;
end
$$;

revoke all on function public.bot_report_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.bot_report_status(uuid, text, text) to service_role;
