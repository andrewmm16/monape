-- Eliminar vacantes archivadas vacías.
-- Amplía la política de borrado para incluir vacantes en estado «archivada»,
-- no solo «borrador». Caso de uso: archivadas creadas por error o «por gusto».
-- La ausencia de postulaciones la garantiza el FK applications.vacancy_id
-- ON DELETE RESTRICT: una archivada con historial no se puede borrar y
-- conserva su trazabilidad. Sigue restringido a administradores.

drop policy if exists vacancies_delete on public.vacancies;

create policy vacancies_delete on public.vacancies
  for delete to authenticated
  using (private.is_admin() and status in ('borrador', 'archivada'));
