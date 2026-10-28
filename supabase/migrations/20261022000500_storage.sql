-- =============================================================================
-- 0005 · Almacenamiento privado de CV
-- Ruta: candidates/{candidate_id}/{resume_id}.{pdf|docx}
--
-- Modelo: el bucket es privado y NO tiene políticas para usuarios. Ni anon ni
-- authenticated pueden listar, leer, firmar, subir ni borrar archivos con su
-- sesión. Todo acceso pasa por el servidor de la aplicación, que antes:
--   * subida  → verifica rol, que el candidato sea visible (RLS), valida el
--               archivo y registra CV + extracción en una transacción;
--   * descarga → verifica acceso al CV (RLS sobre public.resumes), aplica el
--               límite de solicitudes y registra la auditoría; solo entonces
--               firma una URL de 60 segundos.
-- Para ello usa la clave de servicio, que nunca sale del servidor.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  4194304,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
