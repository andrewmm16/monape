-- =============================================================================
-- Lectura local (OCR) de CV en PDF escaneados.
--
-- * resume_extractions.method e intake_batch_items.extraction_method admiten
--   'pdf_ocr'.
--   Semántica (sin columnas nuevas):
--     pdf_text + sin_texto  = OCR aún no intentado (apto para OCR automático)
--     pdf_ocr  + completada = texto obtenido por OCR
--     pdf_ocr  + sin_texto  = OCR intentado sin texto útil (error_code nulo) o
--                             fallido (error_code); no se reintenta solo
-- * consume_rate_limit: nuevo tipo cv_ocr (20 cada 10 minutos). Misma definición
--   que en 20261028000700_evaluation_bulk.sql con un tipo más.
-- * apply_resume_ocr: guarda el resultado del OCR en la extracción de un CV sin
--   pisar jamás el texto corregido por RRHH.
-- =============================================================================

alter table public.resume_extractions drop constraint if exists resume_extractions_method_check;
alter table public.resume_extractions
  add constraint resume_extractions_method_check check (method in ('pdf_text', 'docx_text', 'pdf_ocr'));

alter table public.intake_batch_items drop constraint if exists intake_batch_items_extraction_method_check;
alter table public.intake_batch_items
  add constraint intake_batch_items_extraction_method_check
  check (extraction_method in ('pdf_text', 'docx_text', 'pdf_ocr'));

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
    ('evaluation_bulk', 40, interval '10 minutes'),
    ('cv_ocr', 20, interval '10 minutes')
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

-- -----------------------------------------------------------------------------
-- apply_resume_ocr
-- -----------------------------------------------------------------------------
create function public.apply_resume_ocr(
  p_resume_id uuid,
  p_status public.extraction_status,
  p_extractor_version text,
  p_raw_text text,
  p_suggested_fields jsonb,
  p_warnings text[],
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate_id uuid;
  v_updated integer;
begin
  select r.candidate_id into v_candidate_id from public.resumes r where r.id = p_resume_id;
  if v_candidate_id is null then
    raise exception 'CV no encontrado' using errcode = 'RH404';
  end if;

  if not (
    (select auth.role()) = 'service_role'
    or (private.is_staff() and private.can_access_candidate(v_candidate_id))
  ) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_status not in ('completada', 'sin_texto') then
    raise exception 'Estado de extracción no válido' using errcode = 'RH422';
  end if;
  if p_extractor_version is null or char_length(p_extractor_version) not between 1 and 40 then
    raise exception 'Versión del extractor no válida' using errcode = 'RH422';
  end if;
  if p_raw_text is not null and char_length(p_raw_text) > 200000 then
    raise exception 'El texto supera el máximo permitido' using errcode = 'RH422';
  end if;
  if p_error_code is not null and char_length(p_error_code) > 64 then
    raise exception 'Código de error no válido' using errcode = 'RH422';
  end if;
  if p_suggested_fields is not null and jsonb_typeof(p_suggested_fields) <> 'object' then
    raise exception 'Sugerencias no válidas' using errcode = 'RH422';
  end if;
  if p_status = 'completada' and (p_raw_text is null or p_raw_text = '') then
    raise exception 'Una extracción completada necesita texto' using errcode = 'RH422';
  end if;

  -- Nunca pisa una transcripción de RRHH ni una extracción que ya tiene texto.
  update public.resume_extractions
  set status = p_status,
      method = 'pdf_ocr',
      extractor_version = p_extractor_version,
      raw_text = p_raw_text,
      suggested_fields = coalesce(p_suggested_fields, '{}'::jsonb),
      warnings = coalesce(p_warnings, '{}'),
      error_code = p_error_code,
      updated_at = now()
  where resume_id = p_resume_id
    and corrected_text is null
    and status = 'sin_texto'
    and method in ('pdf_text', 'pdf_ocr');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end
$$;

revoke all on function public.apply_resume_ocr(
  uuid, public.extraction_status, text, text, jsonb, text[], text
) from public, anon;
grant execute on function public.apply_resume_ocr(
  uuid, public.extraction_status, text, text, jsonb, text[], text
) to authenticated, service_role;
