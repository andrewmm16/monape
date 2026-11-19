-- =============================================================================
-- CV de hasta 10 MB
-- Los CV de más de 4 MB (límite del cuerpo de una función en Vercel) se suben
-- directo a Storage con una URL firmada de un solo uso que emite el servidor y
-- se validan después, descargando el archivo. El bucket sigue privado y SIN
-- políticas para usuarios; solo sube su límite de 4 MB a 10 MB. El tipo permitido
-- (PDF y DOCX) no cambia.
-- =============================================================================

update storage.buckets
set file_size_limit = 10485760
where id = 'resumes';

-- El tamaño registrado de cada CV también se acotaba a 4 MB en las tablas.
alter table public.resumes drop constraint resumes_size_bytes_check;
alter table public.resumes
  add constraint resumes_size_bytes_check check (size_bytes > 0 and size_bytes <= 10485760);

alter table public.intake_batch_items drop constraint intake_batch_items_size_bytes_check;
alter table public.intake_batch_items
  add constraint intake_batch_items_size_bytes_check check (size_bytes > 0 and size_bytes <= 10485760);
