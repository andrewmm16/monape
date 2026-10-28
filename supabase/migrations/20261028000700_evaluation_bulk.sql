-- =============================================================================
-- Evaluación masiva de pendientes de una vacante.
--
-- * consume_rate_limit: nuevo tipo evaluation_bulk (40 llamadas cada 10 minutos
--   por usuario). Cada llamada evalúa hasta 25 postulaciones, así que no
--   sustituye al límite `evaluation` de la evaluación individual.
--
-- Misma definición que en 20261027000100_intake.sql con un tipo más. CREATE OR
-- REPLACE conserva los privilegios ya concedidos (solo authenticated).
-- =============================================================================
create or replace function public.consume_rate_limit(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_window interval;
  v_key text;
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  select l.max_requests, l.window_length
  into v_max, v_window
  from (values
    ('cv_upload', 20, interval '10 minutes'),
    ('cv_download', 60, interval '10 minutes'),
    ('evaluation', 30, interval '10 minutes'),
    ('ai_evaluation', 10, interval '10 minutes'),
    ('user_invite', 10, interval '1 hour'),
    ('cv_bulk_upload', 100, interval '10 minutes'),
    ('evaluation_bulk', 40, interval '10 minutes')
  ) as l(bucket, max_requests, window_length)
  where l.bucket = p_bucket;

  if v_max is null then
    raise exception 'Tipo de operación desconocido' using errcode = 'RH422';
  end if;

  v_key := (select auth.uid())::text || ':' || p_bucket;

  insert into private.rate_limits as r (key, window_start, request_count)
  values (v_key, v_now, 1)
  on conflict (key) do update
    set request_count = case
          when r.window_start <= v_now - v_window then 1
          else r.request_count + 1
        end,
        window_start = case
          when r.window_start <= v_now - v_window then v_now
          else r.window_start
        end
  returning request_count into v_count;

  return v_count <= v_max;
end
$$;
