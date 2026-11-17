-- =============================================================================
-- Historial de contacto de la base de talentos y auditoría legible
--
--  * talent_invitations: cada invitación por correo a un candidato de la base
--    (a quién, para qué vacante, quién la envió y con qué resultado). Es el
--    historial que ve RRHH y la base para no escribirle dos veces a la misma
--    persona por la misma vacante. Solo se escribe con record_talent_invitations:
--    no hay permisos directos de escritura, así que queda como registro inmutable.
--  * add_candidates_to_vacancy: reactiva varios candidatos en una sola llamada y
--    deja una línea de resumen del lote en la auditoría.
--  * Etiquetas: la auditoría registra el nombre de la etiqueta (no es un dato
--    personal) para poder mostrar frases legibles.
--
-- La auditoría NO guarda nombres ni correos de candidatos: solo ids, que la
-- pantalla de Auditoría resuelve al mostrar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Invitaciones de la base de talentos
-- -----------------------------------------------------------------------------
create type public.talent_invitation_outcome as enum (
  'enviada', 'sin_correo', 'consentimiento_revocado', 'error'
);

create table public.talent_invitations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  -- Agrupa las invitaciones enviadas en una misma acción.
  batch_id uuid not null,
  outcome public.talent_invitation_outcome not null,
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index talent_invitations_candidate_idx on public.talent_invitations (candidate_id, created_at desc);
create index talent_invitations_vacancy_idx on public.talent_invitations (vacancy_id, candidate_id);

alter table public.talent_invitations enable row level security;

create policy talent_invitations_select on public.talent_invitations
  for select to authenticated using (private.is_staff());

revoke all on table public.talent_invitations from anon, authenticated;
grant select on table public.talent_invitations to authenticated;

-- Registra el resultado de un lote de invitaciones YA procesadas (el correo se
-- envía desde la app). p_items: [{ "candidate_id": uuid, "outcome": texto }].
-- p_already_invited: cuántos se omitieron por estar ya invitados (solo resumen).
-- Devuelve el id del lote.
create function public.record_talent_invitations(
  p_vacancy_id uuid,
  p_items jsonb,
  p_already_invited integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_candidate_id uuid;
  v_outcome public.talent_invitation_outcome;
  v_invitation_id uuid;
  v_counts jsonb := jsonb_build_object('enviada', 0, 'sin_correo', 0, 'consentimiento_revocado', 0, 'error', 0);
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'El lote de invitaciones debe tener entre 1 y 100 candidatos' using errcode = 'RH422';
  end if;
  if not exists (select 1 from public.vacancies where id = p_vacancy_id) then
    raise exception 'La vacante no existe' using errcode = 'RH404';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_candidate_id := (v_item ->> 'candidate_id')::uuid;
    v_outcome := (v_item ->> 'outcome')::public.talent_invitation_outcome;

    insert into public.talent_invitations (candidate_id, vacancy_id, batch_id, outcome, sent_by)
    values (v_candidate_id, p_vacancy_id, v_batch_id, v_outcome, v_actor)
    returning id into v_invitation_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      v_actor,
      'invitacion_cartera',
      'talent_invitations',
      v_invitation_id::text,
      jsonb_build_object(
        'candidate_id', v_candidate_id,
        'vacancy_id', p_vacancy_id,
        'outcome', v_outcome,
        'batch_id', v_batch_id
      )
    );

    v_counts := jsonb_set(v_counts, array[v_outcome::text], to_jsonb((v_counts ->> v_outcome::text)::integer + 1));
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'invitacion_cartera_lote',
    'talent_pool',
    v_batch_id::text,
    jsonb_build_object(
      'vacancy_id', p_vacancy_id,
      'batch_id', v_batch_id,
      'total', jsonb_array_length(p_items),
      'already_invited', greatest(coalesce(p_already_invited, 0), 0)
    ) || v_counts
  );

  return v_batch_id;
end
$$;

revoke all on function public.record_talent_invitations(uuid, jsonb, integer) from public, anon;
grant execute on function public.record_talent_invitations(uuid, jsonb, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Reactivación en lote con resumen en la auditoría
-- Cada candidato va en su propia subtransacción: si uno falla (ya en proceso,
-- ya postulado...), el resto sigue. Los motivos de negocio (RH4xx) se devuelven
-- tal cual; cualquier otro error, con un motivo genérico.
-- Devuelve { batch_id, added: [uuid], failed: [{ candidate_id, reason }] }.
-- -----------------------------------------------------------------------------
create function public.add_candidates_to_vacancy(p_vacancy_id uuid, p_candidate_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_candidate_id uuid;
  v_added uuid[] := '{}';
  v_failed_ids uuid[] := '{}';
  v_failed jsonb := '[]'::jsonb;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_candidate_ids is null or cardinality(p_candidate_ids) not between 1 and 100 then
    raise exception 'El lote debe tener entre 1 y 100 candidatos' using errcode = 'RH422';
  end if;
  if not exists (select 1 from public.vacancies where id = p_vacancy_id) then
    raise exception 'La vacante no existe' using errcode = 'RH404';
  end if;

  for v_candidate_id in select distinct unnest(p_candidate_ids) loop
    begin
      perform public.add_candidate_to_vacancy(v_candidate_id, p_vacancy_id);
      v_added := v_added || v_candidate_id;
    exception when others then
      v_failed_ids := v_failed_ids || v_candidate_id;
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_candidate_id,
        'reason', case when sqlstate like 'RH%' then sqlerrm else 'No se pudo añadir al proceso' end
      ));
    end;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'reactivacion_cartera_lote',
    'talent_pool',
    v_batch_id::text,
    jsonb_build_object(
      'vacancy_id', p_vacancy_id,
      'batch_id', v_batch_id,
      'added', cardinality(v_added),
      'failed', cardinality(v_failed_ids),
      'candidate_ids', to_jsonb(v_added),
      'failed_ids', to_jsonb(v_failed_ids)
    )
  );

  return jsonb_build_object('batch_id', v_batch_id, 'added', to_jsonb(v_added), 'failed', v_failed);
end
$$;

revoke all on function public.add_candidates_to_vacancy(uuid, uuid[]) from public, anon;
grant execute on function public.add_candidates_to_vacancy(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Auditoría legible de etiquetas
-- Reemplaza el disparador genérico (que no guardaba datos de estas tablas) por
-- uno propio que registra el nombre de la etiqueta.
-- -----------------------------------------------------------------------------
drop trigger if exists talent_tags_audit on public.talent_tags;
drop trigger if exists candidate_tags_audit on public.candidate_tags;

create function private.audit_talent_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_action text;
  v_meta jsonb;
begin
  if tg_op = 'INSERT' then
    v_id := new.id;
    v_action := 'etiqueta_creada';
    v_meta := jsonb_build_object('tag', new.name, 'color', new.color);
  elsif tg_op = 'DELETE' then
    v_id := old.id;
    v_action := 'etiqueta_eliminada';
    v_meta := jsonb_build_object('tag', old.name, 'color', old.color);
  else
    if new.name is not distinct from old.name and new.color is not distinct from old.color then
      return null;
    end if;
    v_id := new.id;
    v_action := 'etiqueta_modificada';
    v_meta := jsonb_build_object('tag', new.name, 'color', new.color, 'changes', '{}'::jsonb);
    if new.name is distinct from old.name then
      v_meta := jsonb_set(v_meta, '{changes,name}', jsonb_build_object('from', old.name, 'to', new.name));
    end if;
    if new.color is distinct from old.color then
      v_meta := jsonb_set(v_meta, '{changes,color}', jsonb_build_object('from', old.color, 'to', new.color));
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), v_action, 'talent_tags', v_id::text, v_meta);
  return null;
end
$$;

create function private.audit_candidate_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_candidate_id uuid;
  v_tag_id uuid;
  v_tag text;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_candidate_id := old.candidate_id;
    v_tag_id := old.tag_id;
  else
    v_id := new.id;
    v_candidate_id := new.candidate_id;
    v_tag_id := new.tag_id;
  end if;
  -- Si la etiqueta se está eliminando en cascada, ya no se encuentra su nombre.
  select name into v_tag from public.talent_tags where id = v_tag_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when tg_op = 'DELETE' then 'etiqueta_quitada' else 'etiqueta_asignada' end,
    'candidate_tags',
    v_id::text,
    jsonb_build_object('candidate_id', v_candidate_id, 'tag_id', v_tag_id)
      || case when v_tag is null then '{}'::jsonb else jsonb_build_object('tag', v_tag) end
  );
  return null;
end
$$;

revoke all on function private.audit_talent_tag() from public;
revoke all on function private.audit_candidate_tag() from public;

create trigger talent_tags_audit after insert or update or delete on public.talent_tags
  for each row execute function private.audit_talent_tag();
create trigger candidate_tags_audit after insert or delete on public.candidate_tags
  for each row execute function private.audit_candidate_tag();
