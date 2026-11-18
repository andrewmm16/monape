-- =============================================================================
-- Portal del candidato: seguimiento de una postulación con un enlace privado
--
-- APAGADO por defecto: lo enciende la administración (Configuración → Portal
-- del candidato) cuando RRHH apruebe qué se muestra. Mientras esté apagado, los
-- enlaces no muestran nada.
--
-- * candidate_portal_settings: una sola fila con el interruptor.
-- * application_tracking_tokens: un enlace por postulación. Se guarda solo la
--   huella SHA-256 del token; generar uno nuevo invalida el anterior.
-- * create_application_tracking_link (personal con acceso): devuelve el token.
-- * public_application_status (solo clave de servicio, la usa la página
--   pública): etapa, fechas y próxima entrevista. Nunca notas, evaluación ni
--   motivos internos.
-- =============================================================================

create table public.candidate_portal_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.candidate_portal_settings (id) values (true);

create trigger candidate_portal_settings_set_updated_at before update on public.candidate_portal_settings
  for each row execute function private.set_updated_at();

create trigger candidate_portal_settings_set_updated_by before update on public.candidate_portal_settings
  for each row execute function private.set_actor_column('updated_by');

create trigger candidate_portal_settings_audit
  after update on public.candidate_portal_settings
  for each row execute function private.audit_row_change();

alter table public.candidate_portal_settings enable row level security;

create policy candidate_portal_settings_select on public.candidate_portal_settings
  for select to authenticated using (private.is_staff());

create policy candidate_portal_settings_update on public.candidate_portal_settings
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

revoke all on table public.candidate_portal_settings from anon, authenticated;
grant select on table public.candidate_portal_settings to authenticated;
grant update (enabled) on table public.candidate_portal_settings to authenticated;

create table public.application_tracking_tokens (
  application_id uuid primary key references public.applications (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.application_tracking_tokens enable row level security;
-- Sin políticas ni privilegios: solo las funciones de abajo la usan.
revoke all on table public.application_tracking_tokens from anon, authenticated;

create function private.tracking_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

revoke all on function private.tracking_token_hash(text) from public, anon, authenticated;

-- Genera (o renueva) el enlace de seguimiento de una postulación.
create function public.create_application_tracking_link(p_application_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.is_staff() or not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.applications where id = p_application_id) then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  -- 244 bits aleatorios (dos UUID v4) en hexadecimal.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.application_tracking_tokens (application_id, token_hash, created_by)
  values (p_application_id, private.tracking_token_hash(v_token), (select auth.uid()))
  on conflict (application_id) do update
    set token_hash = excluded.token_hash, created_by = excluded.created_by, created_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'enlace_seguimiento_creado', 'applications', p_application_id::text, '{}'::jsonb);

  return v_token;
end
$$;

revoke all on function public.create_application_tracking_link(uuid) from public, anon;
grant execute on function public.create_application_tracking_link(uuid) to authenticated;

-- Lo que ve la persona candidata. Null si el portal está apagado o el token no existe.
create function public.public_application_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_application public.applications%rowtype;
  v_vacancy_title text;
  v_interview jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  if not coalesce((select s.enabled from public.candidate_portal_settings s where s.id), false) then
    return null;
  end if;

  select a.* into v_application
  from public.application_tracking_tokens t
  join public.applications a on a.id = t.application_id
  where t.token_hash = private.tracking_token_hash(p_token);
  if not found then
    return null;
  end if;

  select v.title into v_vacancy_title from public.vacancies v where v.id = v_application.vacancy_id;

  select jsonb_build_object(
    'scheduled_at', i.scheduled_at,
    'duration_minutes', i.duration_minutes,
    'modality', i.modality,
    'location', i.location
  )
  into v_interview
  from public.interviews i
  where i.application_id = v_application.id and i.status = 'programada' and i.scheduled_at > now()
  order by i.scheduled_at
  limit 1;

  return jsonb_build_object(
    'vacancy_title', v_vacancy_title,
    'stage', case
      when v_application.status in ('nuevo') then 'recibida'
      when v_application.status in ('en_revision', 'preseleccionado', 'en_reserva') then 'en_revision'
      when v_application.status = 'entrevista_programada' then 'entrevista'
      when v_application.status = 'en_evaluacion' then 'evaluacion_final'
      when v_application.status = 'seleccionado' then 'seleccionado'
      else 'finalizado'
    end,
    'applied_at', v_application.applied_at,
    'updated_at', v_application.status_changed_at,
    'next_interview', v_interview
  );
end
$$;

revoke all on function public.public_application_status(text) from public, anon, authenticated;
grant execute on function public.public_application_status(text) to service_role;
