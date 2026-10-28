-- =============================================================================
-- 2.2 · Endurecimiento del formulario público
--
-- consume_public_rate_limit:
-- * 20 por hora por sujeto (antes 5). Revisar con el negocio: detrás de CGNAT
--   móvil varias personas comparten IP. Ahora el servidor lo consume solo
--   después de las comprobaciones baratas, así que no lo gastan los errores
--   de validación.
-- * 300 por hora por vacante y 1000 por día en total, sin cambios.
-- * Purga determinista en cada llamada (hasta 200 filas): borra las claves de
--   sujeto y de vacante (public_apply:*) con la ventana vencida.
-- Misma firma y privilegios que antes (create or replace).
-- =============================================================================
create or replace function public.consume_public_rate_limit(p_subject text, p_vacancy_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_subject is null or p_subject !~ '^[0-9a-f]{64}$' then
    raise exception 'Sujeto no válido' using errcode = 'RH422';
  end if;
  if p_vacancy_code is null or p_vacancy_code !~ '^[a-z0-9]{10}$' then
    raise exception 'Código de vacante no válido' using errcode = 'RH422';
  end if;

  -- Purga acotada de ventanas vencidas (ambas claves usan ventana de 1 hora).
  delete from private.rate_limits
   where key in (
     select r.key from private.rate_limits r
      where (r.key like 'public_apply:subject:%' or r.key like 'public_apply:vacancy:%')
        and r.window_start < v_now - interval '1 hour'
      limit 200
   );

  insert into private.rate_limits as r (key, window_start, request_count)
  values ('public_apply:subject:' || p_subject, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - interval '1 hour' then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - interval '1 hour' then v_now
          else r.window_start
        end
  returning request_count into v_count;
  -- 20 por hora por sujeto: revisar con el negocio.
  if v_count > 20 then
    return false;
  end if;

  insert into private.rate_limits as r (key, window_start, request_count)
  values ('public_apply:vacancy:' || p_vacancy_code, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - interval '1 hour' then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - interval '1 hour' then v_now
          else r.window_start
        end
  returning request_count into v_count;
  if v_count > 300 then
    return false;
  end if;

  insert into private.rate_limits as r (key, window_start, request_count)
  values ('public_apply:day', v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - interval '24 hours' then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - interval '24 hours' then v_now
          else r.window_start
        end
  returning request_count into v_count;
  return v_count <= 1000;
end
$$;
