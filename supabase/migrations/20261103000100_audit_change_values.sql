-- Auditoría con el valor anterior y el nuevo.
--
-- Hasta ahora el registro de una modificación decía solo QUÉ campos cambiaron.
-- Ahora guarda también el valor anterior y el nuevo de los campos de una lista
-- cerrada por tabla, y los datos básicos al crear o eliminar una fila (así, si
-- la fila se elimina, su nombre no se pierde).
--
-- Lista cerrada a propósito: NO se guardan nombres, correos, teléfonos, textos
-- largos ni contenido de CV. Cada valor se recorta a 200 caracteres.

create or replace function private.audit_clip(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then p_value
    when jsonb_typeof(p_value) = 'string' then to_jsonb(left(p_value #>> '{}', 200))
    when length(p_value::text) > 200 then to_jsonb(left(p_value::text, 200))
    else p_value
  end
$$;

create or replace function private.audit_safe_fields(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'vacancies' then array[
      'title', 'department', 'location', 'city', 'region', 'modality', 'contract_type', 'employment_type',
      'opening_date', 'closing_date', 'salary_min', 'salary_max', 'salary_currency', 'salary_period',
      'is_confidential', 'status'
    ]
    when 'vacancy_requirements' then array[
      'description', 'category', 'priority', 'weight', 'min_years', 'is_essential', 'keywords', 'position'
    ]
    when 'interviews' then array['scheduled_at', 'duration_minutes', 'modality', 'location', 'status', 'result', 'cancel_reason']
    when 'applications' then array['status', 'intake_method']
    when 'profiles' then array['role', 'is_active']
    when 'privacy_notices' then array['title', 'status', 'effective_from', 'approval_reference']
    when 'consent_records' then array['purpose', 'granted', 'method']
    when 'candidates' then array['source']
    else array[]::text[]
  end
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_meta jsonb := '{}'::jsonb;
  v_safe text[] := private.audit_safe_fields(tg_table_name);
  v_changes jsonb := '{}'::jsonb;
  v_values jsonb := '{}'::jsonb;
  v_tracked constant text[] := array[
    'status', 'role', 'is_active', 'criteria_version', 'review_status',
    'review_outcome', 'is_current', 'origin', 'assigned_evaluator_id', 'profile_id'
  ];
  k text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;

    select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at'
      and n.value is distinct from (v_old -> n.key);

    if cardinality(v_changed) = 0 then
      return null;
    end if;

    v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
    foreach k in array v_tracked loop
      if k = any (v_changed) then
        v_meta := v_meta || jsonb_build_object(
          k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k)
        );
      end if;
    end loop;

    -- Valor anterior y nuevo de los campos permitidos que cambiaron.
    foreach k in array v_safe loop
      if k = any (v_changed) then
        v_changes := v_changes || jsonb_build_object(
          k, jsonb_build_object('from', private.audit_clip(v_old -> k), 'to', private.audit_clip(v_new -> k))
        );
      end if;
    end loop;
    if v_changes <> '{}'::jsonb then
      v_meta := v_meta || jsonb_build_object('changes', v_changes);
    end if;
  end if;

  if tg_op <> 'UPDATE' then
    foreach k in array v_tracked loop
      if v_row ? k then
        v_meta := v_meta || jsonb_build_object(k, v_row -> k);
      end if;
    end loop;

    -- Al crear o eliminar: los datos básicos permitidos de la fila.
    foreach k in array v_safe loop
      if v_row ? k and jsonb_typeof(v_row -> k) <> 'null' then
        v_values := v_values || jsonb_build_object(k, private.audit_clip(v_row -> k));
      end if;
    end loop;
    if v_values <> '{}'::jsonb then
      v_meta := v_meta || jsonb_build_object('values', v_values);
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'vacancy_id'),
    v_meta
  );
  return null;
end
$$;
