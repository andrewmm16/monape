-- =============================================================================
-- Plazo de conservación: candidatos inactivos y anonimización
--
-- Los datos de candidatos no se guardan para siempre: la administración revisa
-- quiénes llevan N meses sin actividad (sin postulación en curso) y los
-- anonimiza a mano. Nada se borra solo.
--
-- Anonimizar quita los datos personales y el contenido del CV, pero conserva
-- las postulaciones con su estado y fechas (los reportes siguen cuadrando):
-- * candidates: nombre genérico, sin correo, teléfono, ubicación ni LinkedIn;
-- * se borran los CV (los archivos los limpia la tarea de limpieza de CV), el
--   perfil extraído, las etiquetas y los prospectos de Caleta vinculados;
-- * se vacían los textos libres que pueden contener datos personales: notas
--   del historial, resúmenes y citas de las evaluaciones, respuestas abiertas,
--   notas de verificación, comentarios de las entrevistas y su evaluación;
-- * se conservan los registros de consentimiento (prueban qué se autorizó).
-- Es irreversible y queda en la auditoría. Una persona anonimizada no puede
-- volver a postular con ese registro.
-- =============================================================================

alter table public.candidates add column anonymized_at timestamptz;

-- Última actividad: alta, cambios, postulaciones, historial e invitaciones.
create function private.candidate_last_activity(p_candidate_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select c.updated_at from public.candidates c where c.id = p_candidate_id),
    (select max(a.updated_at) from public.applications a where a.candidate_id = p_candidate_id),
    (select max(e.created_at) from public.application_events e
       join public.applications a on a.id = e.application_id
      where a.candidate_id = p_candidate_id),
    (select max(t.created_at) from public.talent_invitations t where t.candidate_id = p_candidate_id),
    (select max(r.created_at) from public.consent_records r where r.candidate_id = p_candidate_id)
  )
$$;

revoke all on function private.candidate_last_activity(uuid) from public, anon, authenticated;

-- Candidatos sin actividad en p_months meses, sin postulación en curso y sin
-- anonimizar, del más antiguo al más reciente. Solo administración.
create function public.list_inactive_candidates(p_months integer default 24, p_limit integer default 200)
returns table (
  candidate_id uuid,
  full_name text,
  last_activity timestamptz,
  applications integer,
  pool_consent text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_months is null or p_months not between 6 and 120 then
    raise exception 'El plazo debe estar entre 6 y 120 meses' using errcode = 'RH422';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'El límite debe estar entre 1 y 500' using errcode = 'RH422';
  end if;

  return query
  select c.id, c.full_name, act.last_activity,
    (select count(*)::integer from public.applications a where a.candidate_id = c.id),
    coalesce((
      select case when r.granted and r.revoked_at is null then 'consiente'
                  when r.granted then 'revocado' else 'sin' end
      from public.consent_records r
      where r.candidate_id = c.id and r.purpose = 'cartera_talento'
      order by r.created_at desc
      limit 1
    ), 'sin')
  from public.candidates c
  cross join lateral (select private.candidate_last_activity(c.id) as last_activity) act
  where c.anonymized_at is null
    and act.last_activity < now() - make_interval(months => p_months)
    and not exists (
      select 1 from public.applications a
      where a.candidate_id = c.id and private.is_application_in_process(a.status)
    )
  order by act.last_activity
  limit p_limit;
end
$$;

revoke all on function public.list_inactive_candidates(integer, integer) from public, anon;
grant execute on function public.list_inactive_candidates(integer, integer) to authenticated;

create function public.anonymize_candidate(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.candidates%rowtype;
  v_resumes integer;
begin
  if not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_candidate from public.candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'Candidato no encontrado' using errcode = 'RH404';
  end if;
  if v_candidate.anonymized_at is not null then
    raise exception 'El candidato ya está anonimizado' using errcode = 'RH409';
  end if;
  if exists (
    select 1 from public.applications a
    where a.candidate_id = p_candidate_id and private.is_application_in_process(a.status)
  ) then
    raise exception 'Tiene una postulación en curso: ciérrela antes de anonimizar' using errcode = 'RH409';
  end if;

  -- CV (y su texto extraído, en cascada), perfil, etiquetas y prospectos de Caleta.
  delete from public.resumes where candidate_id = p_candidate_id;
  get diagnostics v_resumes = row_count;
  delete from public.candidate_profile_items where candidate_id = p_candidate_id;
  delete from public.candidate_tags where candidate_id = p_candidate_id;
  delete from public.caleta_prospects where candidate_id = p_candidate_id;

  -- Textos libres ligados a sus postulaciones.
  update public.application_events e
  set note = case when e.event_type = 'observacion' then '[anonimizado]' end,
      reason = null
  from public.applications a
  where a.id = e.application_id and a.candidate_id = p_candidate_id
    and (e.note is not null or e.reason is not null);

  update public.candidate_evaluations ev
  set summary = 'Evaluación anonimizada.', limitations = '{}', review_notes = null
  from public.applications a
  where a.id = ev.application_id and a.candidate_id = p_candidate_id;

  update public.candidate_evaluation_items it
  set evidence = '[]'::jsonb, rationale = '', cv_rationale = null, verification_note = null
  from public.candidate_evaluations ev
  join public.applications a on a.id = ev.application_id
  where ev.id = it.evaluation_id and a.candidate_id = p_candidate_id;

  update public.application_killer_answers k
  set answer_text = null
  from public.applications a
  where a.id = k.application_id and a.candidate_id = p_candidate_id and k.answer_text is not null;

  update public.requirement_verifications v
  set note = 'Dato anonimizado'
  from public.applications a
  where a.id = v.application_id and a.candidate_id = p_candidate_id;

  update public.interviews i
  set result_notes = case when i.result_notes is null then null else '[anonimizado]' end,
      cancel_reason = case when i.cancel_reason is null then null else '[anonimizado]' end,
      instructions = null
  from public.applications a
  where a.id = i.application_id and a.candidate_id = p_candidate_id;

  update public.interview_scorecards s
  set comment = null
  from public.interviews i
  join public.applications a on a.id = i.application_id
  where s.interview_id = i.id and a.candidate_id = p_candidate_id and s.comment is not null;

  update public.applications
  set possible_duplicate_reasons = '{}'
  where candidate_id = p_candidate_id and cardinality(possible_duplicate_reasons) > 0;

  update public.intake_batch_items
  set full_name = null, email = null, phone = null, raw_text = null, suggested_fields = '{}'::jsonb
  where candidate_id = p_candidate_id;

  update public.candidates
  set full_name = 'Persona anonimizada ' || left(p_candidate_id::text, 8),
      email = null,
      phone = null,
      location = null,
      linkedin_url = null,
      source_detail = null,
      field_origins = '{}'::jsonb,
      anonymized_at = now()
  where id = p_candidate_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'candidato_anonimizado',
    'candidates',
    p_candidate_id::text,
    jsonb_build_object('resumes_deleted', v_resumes)
  );
end
$$;

revoke all on function public.anonymize_candidate(uuid) from public, anon;
grant execute on function public.anonymize_candidate(uuid) to authenticated;

-- Una persona anonimizada no vuelve a un proceso con ese registro.
create function private.reject_anonymized_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.candidates c where c.id = new.candidate_id and c.anonymized_at is not null) then
    raise exception 'La persona fue anonimizada: regístrela de nuevo si vuelve a postular' using errcode = 'RH409';
  end if;
  return new;
end
$$;

revoke all on function private.reject_anonymized_application() from public, anon, authenticated;

create trigger applications_reject_anonymized
  before insert on public.applications
  for each row execute function private.reject_anonymized_application();
