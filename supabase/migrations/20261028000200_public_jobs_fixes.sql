-- =============================================================================
-- 2.9 · Correcciones: código público para vacantes ya publicadas
--
-- El disparador original solo asignaba `public_code` y `first_published_at` al
-- pasar a `publicada`. Las vacantes que ya estaban publicadas antes de la
-- migración 20261028000100 nunca los recibieron. Ahora se asignan siempre que
-- la vacante esté `publicada` y no tenga código; si ya existe, no cambia nunca.
-- La validación de datos sigue aplicándose solo al pasar a `publicada`.
-- =============================================================================

create or replace function private.vacancy_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
  v_code text;
  v_becoming_published boolean;
begin
  if tg_op = 'INSERT' then
    new.public_code := null;
    new.first_published_at := null;
  else
    new.public_code := old.public_code;
    new.first_published_at := old.first_published_at;
  end if;

  if new.status <> 'publicada' then
    return new;
  end if;

  v_becoming_published := tg_op = 'INSERT' or old.status <> 'publicada';

  -- Como el resto de reglas de ciclo de vida, solo se exige a usuarios: las
  -- cargas de servicio (migraciones, datos ficticios) no pasan por aquí.
  if v_becoming_published and (select auth.uid()) is not null and not new.is_confidential then
    if char_length(btrim(new.description)) < 50 then
      v_missing := array_append(v_missing, 'una descripción de al menos 50 caracteres');
    end if;
    if new.employment_type is null then
      v_missing := array_append(v_missing, 'el tipo de empleo');
    end if;
    if new.modality is distinct from 'remoto'
       and (btrim(coalesce(new.city, '')) = '' or btrim(coalesce(new.region, '')) = '') then
      v_missing := array_append(v_missing, 'la ciudad y la región');
    end if;
    if cardinality(v_missing) > 0 then
      raise exception 'Para publicar la vacante se necesita: %. También puede marcarla como confidencial.',
        array_to_string(v_missing, ', ')
        using errcode = 'RH422';
    end if;
  end if;

  if new.public_code is null then
    loop
      v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      exit when not exists (select 1 from public.vacancies where public_code = v_code);
    end loop;
    new.public_code := v_code;
  end if;
  if new.first_published_at is null then
    new.first_published_at := now();
  end if;
  return new;
end
$$;

-- Vacantes publicadas antes de 20261028000100: reciben código y fecha. Las
-- cerradas sin código nunca fueron públicas y no se tocan. El disparador
-- asigna ambos valores al actualizar la fila.
update public.vacancies
   set status = status
 where status = 'publicada'
   and public_code is null;
