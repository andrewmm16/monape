-- =============================================================================
-- Coordenadas del lugar de la entrevista presencial
--
-- La dirección elegida con el autocompletado guarda su punto (latitud y
-- longitud) para mostrar el mapa. Las columnas son opcionales: una dirección
-- escrita a mano se guarda sin coordenadas.
--
-- schedule_interview y reschedule_interview no cambian; la acción del servidor
-- guarda las coordenadas después con set_interview_coordinates.
-- =============================================================================

alter table public.interviews
  add column location_lat double precision,
  add column location_lng double precision;

alter table public.interviews
  add constraint interviews_location_lat_range check (location_lat between -90 and 90),
  add constraint interviews_location_lng_range check (location_lng between -180 and 180),
  add constraint interviews_location_coords_together
    check ((location_lat is null) = (location_lng is null));

-- Guarda (o borra, con null y null) el punto del lugar de una entrevista
-- presencial. Mismas comprobaciones de acceso que reschedule_interview.
create function public.set_interview_coordinates(
  p_interview_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.interviews%rowtype;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_interview from public.interviews where id = p_interview_id for update;
  if not found then
    raise exception 'La entrevista no existe' using errcode = 'RH404';
  end if;
  if not private.can_access_application(v_interview.application_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Indique la latitud y la longitud, o ninguna de las dos' using errcode = 'RH422';
  end if;
  if p_lat is not null then
    if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
      raise exception 'Las coordenadas están fuera de rango' using errcode = 'RH422';
    end if;
    if v_interview.modality <> 'presencial' then
      raise exception 'Solo una entrevista presencial tiene coordenadas' using errcode = 'RH422';
    end if;
  end if;

  update public.interviews
  set location_lat = p_lat,
      location_lng = p_lng
  where id = p_interview_id;
end;
$$;

revoke all on function public.set_interview_coordinates(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_interview_coordinates(uuid, double precision, double precision) to authenticated;
