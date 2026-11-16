-- =============================================================================
-- Mensaje libre al candidato: evento de historial «correo enviado»
--
-- Registra en el historial de la postulación que RRHH envió un correo libre a
-- la persona candidata. Guarda SOLO el asunto (en note), nunca el cuerpo: deja
-- constancia de la comunicación sin almacenar su contenido personal. El correo
-- en sí lo envía el servidor (Resend); esta función solo deja la constancia,
-- como el resto de eventos que no son observaciones.
-- =============================================================================

alter type public.application_event_type add value if not exists 'correo_enviado';

create function public.log_candidate_message(p_application_id uuid, p_subject text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text := btrim(coalesce(p_subject, ''));
begin
  if not private.can_access_application(p_application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if char_length(v_subject) = 0 then
    raise exception 'Indique el asunto del correo.' using errcode = 'RH422';
  end if;
  if char_length(v_subject) > 200 then
    raise exception 'El asunto no puede superar 200 caracteres.' using errcode = 'RH422';
  end if;

  insert into public.application_events (application_id, event_type, note, actor_id)
  values (p_application_id, 'correo_enviado', v_subject, (select auth.uid()));
end
$$;

revoke all on function public.log_candidate_message(uuid, text) from public, anon;
grant execute on function public.log_candidate_message(uuid, text) to authenticated;
