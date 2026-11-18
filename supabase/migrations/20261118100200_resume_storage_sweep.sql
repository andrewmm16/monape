-- =============================================================================
-- Barrido de archivos huérfanos del bucket de CV
--
-- Un archivo del bucket `resumes` queda huérfano cuando nada lo referencia:
-- * se eliminó el candidato (por SQL o en cascada) o su CV, y Storage no se
--   puede limpiar desde la base de datos;
-- * el servidor se cayó entre subir el archivo y registrarlo (formulario
--   público, Talent.com, robot de portales o carga masiva).
--
-- list_orphan_resume_files devuelve esos archivos y la tarea programada
-- GET /api/tareas/limpieza-cv los borra con la API de Storage. Solo considera
-- las dos carpetas que usa la aplicación (candidates/ e intake/) y deja un
-- margen de 48 h desde el último cambio del archivo, para no tocar un archivo
-- que se está subiendo o moviendo en ese momento. Solo para la clave de servicio.
-- =============================================================================

create function public.list_orphan_resume_files(
  p_min_age_hours integer default 48,
  p_limit integer default 500
)
returns table (name text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_min_age_hours is null or p_min_age_hours < 24 then
    raise exception 'El margen mínimo es de 24 horas' using errcode = 'RH422';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'El límite debe estar entre 1 y 1000' using errcode = 'RH422';
  end if;

  return query
  select o.name, greatest(o.created_at, o.updated_at)
  from storage.objects o
  where o.bucket_id = 'resumes'
    and (o.name like 'candidates/%' or o.name like 'intake/%')
    and greatest(o.created_at, o.updated_at) < now() - make_interval(hours => p_min_age_hours)
    and not exists (select 1 from public.resumes r where r.storage_path = o.name)
    and not exists (select 1 from public.intake_batch_items i where i.storage_path = o.name)
  order by greatest(o.created_at, o.updated_at)
  limit p_limit;
end
$$;

revoke all on function public.list_orphan_resume_files(integer, integer) from public, anon, authenticated;
grant execute on function public.list_orphan_resume_files(integer, integer) to service_role;
