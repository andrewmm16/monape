-- =============================================================================
-- apply_resume_ocr: no perder texto digital parcial.
--
-- Un PDF con poco texto digital (menos de 80 caracteres) queda sin_texto con ese
-- raw_text, y ese texto ya alcanza para evaluar. Si el OCR no logra un resultado
-- completado (sin texto útil o fallido), no puede reemplazar un raw_text no vacío
-- por nulo ni por uno más corto. Con `completada` se reemplaza como antes.
-- Misma firma, privilegios y autorización que en 20261028000800_resume_ocr.sql.
-- =============================================================================
create or replace function public.apply_resume_ocr(
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
      raw_text = case
        when p_status <> 'completada'
          and coalesce(raw_text, '') <> ''
          and (p_raw_text is null or char_length(p_raw_text) < char_length(raw_text))
        then raw_text
        else p_raw_text
      end,
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
