-- =============================================================================
-- 0012 · Carga masiva: endurecimiento tras la revisión
--
-- * Los datos personales del ítem no sobreviven al registro ni al candidato.
-- * El lote se cierra solo con close_intake_batch (sin UPDATE directo) y un
--   lote cerrado no se reabre ni admite ítems nuevos o ediciones.
-- * storage_path tiene una forma exacta ligada al lote y al ítem.
-- =============================================================================

-- --- 1a. Borrar al candidato borra el ítem que lo registró -------------------
alter table public.intake_batch_items
  drop constraint intake_batch_items_candidate_id_fkey,
  add constraint intake_batch_items_candidate_id_fkey
    foreign key (candidate_id) references public.candidates (id) on delete cascade;

-- --- 3. Forma exacta de la ruta temporal -------------------------------------
alter table public.intake_batch_items
  drop constraint intake_batch_items_path_check,
  add constraint intake_batch_items_path_check
    check (
      storage_path is null
      or storage_path ~ ('^intake/' || batch_id::text || '/' || id::text || '\.(pdf|docx)$')
    );

-- --- Ítems en lotes cerrados: sin altas ni ediciones -------------------------
create or replace function private.prepare_intake_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'registrado' then
      raise exception 'Un ítem nuevo no puede estar registrado' using errcode = 'RH422';
    end if;
    -- Mismo candado que close_intake_batch: o el ítem entra antes del cierre
    -- (y el cierre lo borra) o falla porque el lote ya está cerrado.
    perform pg_advisory_xact_lock(hashtextextended('intake:' || new.batch_id::text, 0));
    if (select count(*) from public.intake_batch_items i where i.batch_id = new.batch_id) >= 50 then
      raise exception 'Un lote admite como máximo 50 archivos' using errcode = 'RH422';
    end if;
  end if;

  -- Los ítems ya registrados de lotes cerrados se conservan como historial.
  if (tg_op = 'INSERT' or new.status in ('listo', 'requiere_datos')) and not exists (
    select 1 from public.intake_batches b where b.id = new.batch_id and b.status = 'abierto'
  ) then
    raise exception 'El lote está cerrado' using errcode = 'RH409';
  end if;

  new.full_name := nullif(btrim(new.full_name), '');
  new.email := nullif(btrim(new.email), '');
  new.phone := nullif(btrim(new.phone), '');

  if new.status in ('listo', 'requiere_datos') then
    new.status := case when new.full_name is not null then 'listo' else 'requiere_datos' end;
  end if;
  return new;
end
$$;

-- --- 2. Cierre del lote solo mediante la función -----------------------------
create function private.prevent_batch_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cerrado' and new.status <> 'cerrado' then
    raise exception 'Un lote cerrado no se puede reabrir' using errcode = 'RH409';
  end if;
  return new;
end
$$;

create trigger intake_batches_prevent_reopen
  before update on public.intake_batches
  for each row execute function private.prevent_batch_reopen();

revoke update (status, closed_at) on table public.intake_batches from authenticated;
drop policy intake_batches_update on public.intake_batches;

create function public.close_intake_batch(p_batch_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.intake_batch_status;
  v_paths text[];
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('intake:' || p_batch_id::text, 0));
  select b.status into v_status from public.intake_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'Lote no encontrado' using errcode = 'RH404';
  end if;
  if v_status <> 'abierto' then
    raise exception 'El lote ya está cerrado' using errcode = 'RH409';
  end if;

  update public.intake_batches set status = 'cerrado', closed_at = now() where id = p_batch_id;

  with removed as (
    delete from public.intake_batch_items i
    where i.batch_id = p_batch_id and i.status <> 'registrado'
    returning i.storage_path
  )
  select coalesce(array_agg(r.storage_path) filter (where r.storage_path is not null), '{}')
  into v_paths
  from removed r;

  return v_paths;
end
$$;

revoke all on function public.close_intake_batch(uuid) from public, anon;
grant execute on function public.close_intake_batch(uuid) to authenticated;

-- --- 1b. El registro no conserva correo, teléfono ni sugerencias -------------
create or replace function public.register_batch_item(
  p_item_id uuid,
  p_candidate_id uuid,
  p_resume_id uuid,
  p_storage_path text,
  p_extractor_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.intake_batch_items%rowtype;
  v_batch public.intake_batches%rowtype;
  v_portal public.job_portals%rowtype;
  v_origins jsonb := '{}'::jsonb;
  v_suggested_email text;
  v_suggested_phone text;
  v_application_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_item from public.intake_batch_items where id = p_item_id for update;
  if not found then
    raise exception 'Archivo del lote no encontrado' using errcode = 'RH404';
  end if;
  select * into v_batch from public.intake_batches where id = v_item.batch_id for update;
  if v_batch.status <> 'abierto' then
    raise exception 'El lote está cerrado' using errcode = 'RH409';
  end if;
  if v_item.status = 'registrado' then
    raise exception 'El archivo ya fue registrado' using errcode = 'RH409';
  end if;
  if v_item.status = 'error' then
    raise exception 'El archivo tiene un error y no se puede registrar' using errcode = 'RH409';
  end if;
  if v_item.full_name is null then
    raise exception 'Falta el nombre del candidato' using errcode = 'RH422';
  end if;
  if v_item.extraction_status is null or v_item.extraction_method is null
     or v_item.sha256 is null or v_item.mime_type is null or v_item.size_bytes is null then
    raise exception 'El archivo no tiene datos de extracción' using errcode = 'RH422';
  end if;
  if p_storage_path not like 'candidates/' || p_candidate_id::text || '/%' then
    raise exception 'Ruta de archivo no válida' using errcode = 'RH422';
  end if;

  select * into v_portal from public.job_portals where id = v_batch.portal_id;
  if not v_portal.is_active then
    raise exception 'El portal ya no está activo' using errcode = 'RH409';
  end if;

  v_suggested_email := lower(btrim(v_item.suggested_fields #>> '{email,value}'));
  v_suggested_phone := private.normalize_phone(v_item.suggested_fields #>> '{phone,value}');
  v_origins := jsonb_build_object(
    'full_name', case when v_item.name_from_cv then 'extraido' else 'declarado' end
  );
  if v_item.email is not null then
    v_origins := v_origins || jsonb_build_object(
      'email', case when lower(v_item.email) = v_suggested_email then 'extraido' else 'declarado' end
    );
  end if;
  if v_item.phone is not null then
    v_origins := v_origins || jsonb_build_object(
      'phone', case when private.normalize_phone(v_item.phone) = v_suggested_phone
                    then 'extraido' else 'declarado' end
    );
  end if;

  insert into public.candidates (id, full_name, email, phone, source, source_detail, field_origins)
  values (
    p_candidate_id, v_item.full_name, v_item.email, v_item.phone,
    v_portal.candidate_source, v_portal.name, v_origins
  );

  perform public.register_resume(
    p_resume_id, p_candidate_id, p_storage_path, v_item.original_filename, v_item.mime_type,
    v_item.size_bytes, v_item.sha256, v_item.extraction_status, v_item.extraction_method,
    p_extractor_version, v_item.raw_text, v_item.suggested_fields, v_item.warnings,
    case when v_item.extraction_status = 'fallida' then v_item.error_code end
  );

  insert into public.applications (candidate_id, vacancy_id, resume_id, portal_id, intake_method)
  values (p_candidate_id, v_batch.vacancy_id, p_resume_id, v_portal.id, 'carga_masiva')
  returning id into v_application_id;

  -- Los datos personales quedan solo en el candidato y en resume_extractions;
  -- del ítem se conservan el nombre y el archivo de origen.
  update public.intake_batch_items
  set status = 'registrado',
      candidate_id = p_candidate_id,
      application_id = v_application_id,
      raw_text = null,
      storage_path = null,
      email = null,
      phone = null,
      suggested_fields = '{}'::jsonb
  where id = p_item_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'carga_masiva',
    'applications',
    v_application_id::text,
    jsonb_build_object(
      'intake_method', 'carga_masiva',
      'portal_id', v_portal.id,
      'portal', v_portal.name,
      'batch_id', v_batch.id
    )
  );

  return v_application_id;
end
$$;

-- --- 1c. Limpieza de lo ya registrado ----------------------------------------
update public.intake_batch_items
set email = null, phone = null, suggested_fields = '{}'::jsonb
where status = 'registrado';

delete from public.intake_batch_items
where status = 'registrado' and candidate_id is null;
