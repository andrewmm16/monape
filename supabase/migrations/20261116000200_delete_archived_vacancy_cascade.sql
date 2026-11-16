-- Borrado en cascada de una vacante ARCHIVADA (con postulaciones).
--
-- El borrado normal (política vacancies_delete) solo permite eliminar vacantes
-- vacías, porque applications.vacancy_id es ON DELETE RESTRICT (y también lo son
-- intake_batches y portal_publications). Esta función, solo para administradores
-- y solo sobre vacantes «archivada», elimina de forma deliberada y atómica la
-- vacante junto con sus postulaciones y su historial, y con los candidatos que
-- queden sin ninguna otra postulación («huérfanos»). Devuelve las rutas de los
-- CV de esos candidatos para que el servidor limpie el bucket de Storage.
--
-- Lo que cuelga de una postulación (evaluaciones, entrevistas, eventos,
-- respuestas killer, notificaciones, verificaciones) ya está en ON DELETE
-- CASCADE; lo que cuelga de un candidato (CV, perfil, consentimientos) también.

create function public.delete_archived_vacancy(p_vacancy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.vacancy_status;
  v_candidate_ids uuid[];
  v_orphans uuid[];
  v_paths text[];
  v_apps int := 0;
  v_cands int := 0;
begin
  if not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select v.status into v_status
  from public.vacancies v
  where v.id = p_vacancy_id
  for update;

  if not found then
    raise exception 'Vacante no encontrada' using errcode = 'RH404';
  end if;
  if v_status <> 'archivada' then
    raise exception 'Solo se puede eliminar en cascada una vacante archivada' using errcode = 'RH409';
  end if;

  -- Candidatos con una postulación a esta vacante (para evaluar orfandad luego).
  select coalesce(array_agg(distinct a.candidate_id), '{}')
  into v_candidate_ids
  from public.applications a
  where a.vacancy_id = p_vacancy_id;

  -- Referencias RESTRICT que bloquean el borrado de la vacante.
  delete from public.portal_publications where vacancy_id = p_vacancy_id;
  delete from public.intake_batches where vacancy_id = p_vacancy_id;

  -- Postulaciones de la vacante (arrastran su historial por CASCADE).
  delete from public.applications where vacancy_id = p_vacancy_id;
  get diagnostics v_apps = row_count;

  -- Candidatos huérfanos: sin ninguna otra postulación tras el borrado.
  select coalesce(array_agg(cid), '{}')
  into v_orphans
  from unnest(v_candidate_ids) as cid
  where not exists (select 1 from public.applications a2 where a2.candidate_id = cid);

  -- Rutas de los CV de esos candidatos, para limpiar Storage desde el servidor.
  select coalesce(array_agg(r.storage_path), '{}')
  into v_paths
  from public.resumes r
  where r.candidate_id = any(v_orphans);

  if array_length(v_orphans, 1) is not null then
    delete from public.candidates where id = any(v_orphans);
    get diagnostics v_cands = row_count;
  end if;

  delete from public.vacancies where id = p_vacancy_id;

  return jsonb_build_object(
    'deleted_applications', v_apps,
    'deleted_candidates', v_cands,
    'resume_paths', to_jsonb(v_paths)
  );
end
$$;

revoke all on function public.delete_archived_vacancy(uuid) from public, anon;
grant execute on function public.delete_archived_vacancy(uuid) to authenticated;
