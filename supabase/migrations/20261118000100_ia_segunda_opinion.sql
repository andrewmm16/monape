-- =============================================================================
-- La evaluación con IA es una SEGUNDA OPINIÓN: no desplaza a la del motor de reglas.
--
-- record_evaluation_core deja como vigente (applications.latest_evaluation_id) la
-- última evaluación registrada, sea del método que sea. Con la cola de IA, la
-- segunda opinión llega minutos después que la del motor y pasaba a ser la vigente:
-- el ranking y los listados de la vacante mezclaban puntajes del motor y de la IA,
-- y las verificaciones de RRHH se aplicaban sobre la de la IA.
--
-- Regla: si la vigente es del motor y la nueva es de IA sobre el MISMO CV y la
-- MISMA versión de criterios, la del motor sigue vigente. La de IA solo pasa a
-- vigente si no hay una del motor o si la del motor quedó vieja (otro CV u otros
-- criterios). La evaluación con IA se registra igual y se muestra dentro de la
-- del motor (página de la postulación).
--
-- Es un trigger y no un cambio en record_evaluation_core para no duplicar esa
-- función (la usan el motor, la IA, las integraciones y las verificaciones).
-- =============================================================================

create or replace function private.keep_rules_evaluation_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.candidate_evaluations%rowtype;
  v_old public.candidate_evaluations%rowtype;
begin
  if new.latest_evaluation_id is null
     or old.latest_evaluation_id is null
     or new.latest_evaluation_id = old.latest_evaluation_id then
    return new;
  end if;

  select * into v_new from public.candidate_evaluations where id = new.latest_evaluation_id;
  select * into v_old from public.candidate_evaluations where id = old.latest_evaluation_id;

  if v_new.method = 'ia'
     and v_old.method = 'reglas'
     and v_new.resume_id is not distinct from v_old.resume_id
     and v_new.criteria_version = v_old.criteria_version then
    new.latest_evaluation_id := old.latest_evaluation_id;
  end if;
  return new;
end
$$;

revoke all on function private.keep_rules_evaluation_current() from public;

create trigger applications_keep_rules_evaluation_current
before update of latest_evaluation_id on public.applications
for each row execute function private.keep_rules_evaluation_current();
