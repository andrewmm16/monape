-- =============================================================================
-- Portal del candidato: enlace de seguimiento ESTABLE
--
-- El enlace va ahora en los correos a la persona candidata (acuse, cambios de
-- estado y entrevistas). Para que el de un correo anterior siga funcionando,
-- cada postulación conserva su enlace: se guarda el token (antes solo su
-- huella, lo que obligaba a generar uno nuevo cada vez). El token solo da
-- acceso de lectura a la etapa de UNA postulación y la tabla no tiene
-- privilegios para nadie: solo la leen las funciones de abajo.
--
-- * get_application_tracking_link: devuelve el enlace de la postulación (lo crea
--   si no existe). Con p_renew = true genera uno nuevo y el anterior deja de
--   funcionar. Personal con acceso, o la clave de servicio (formulario público).
-- * public_application_status: busca por el token.
--
-- La tabla solo tenía enlaces de prueba (el portal nunca se encendió fuera de
-- local), por eso se vacía al cambiar la columna.
-- =============================================================================

truncate public.application_tracking_tokens;

alter table public.application_tracking_tokens drop column token_hash;
alter table public.application_tracking_tokens
  add column token text not null unique check (token ~ '^[0-9a-f]{64}$');

drop function public.create_application_tracking_link(uuid);
drop function private.tracking_token_hash(text);

create function public.get_application_tracking_link(p_application_id uuid, p_renew boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service boolean := coalesce((select auth.role()) = 'service_role', false);
  v_token text;
begin
  if not v_service and not (private.is_staff() and private.can_access_application(p_application_id)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.applications where id = p_application_id) then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  if not coalesce(p_renew, false) then
    select t.token into v_token from public.application_tracking_tokens t where t.application_id = p_application_id;
    if v_token is not null then
      return v_token;
    end if;
  end if;

  -- 244 bits aleatorios (dos UUID v4) en hexadecimal.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.application_tracking_tokens (application_id, token, created_by)
  values (p_application_id, v_token, (select auth.uid()))
  on conflict (application_id) do update
    set token = excluded.token, created_by = excluded.created_by, created_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when coalesce(p_renew, false) then 'enlace_seguimiento_renovado' else 'enlace_seguimiento_creado' end,
    'applications',
    p_application_id::text,
    '{}'::jsonb
  );
  return v_token;
end
$$;

revoke all on function public.get_application_tracking_link(uuid, boolean) from public, anon;
grant execute on function public.get_application_tracking_link(uuid, boolean) to authenticated, service_role;

create or replace function public.public_application_status(p_token text)
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
  where t.token = p_token;
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
