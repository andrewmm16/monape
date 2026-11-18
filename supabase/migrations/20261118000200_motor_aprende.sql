-- =============================================================================
-- El motor aprende de la IA (reglas aprendidas) y la IA releva al motor en lo dudoso.
--
-- 1. learned_equivalences: lo que el motor aprende. Cuando el motor duda (un cargo
--    parecido, una habilidad relacionada, una errata, términos que no aparecen) y la
--    IA resuelve la duda señalando un término concreto del CV, se registra un voto
--    (««Asistente de Residencia» cuenta / no cuenta como lo que pide este requisito»).
--    Con N votos de CV distintos en el mismo sentido y NINGUNO en contra, pasa al
--    segundo juez (otro modelo, más capaz); si está de acuerdo, la regla se activa y
--    el motor la aplica solo, sin volver a consultar a la IA. Nadie tiene que aprobar.
--    Se suspende sola si la IA opina lo contrario en otro CV o si RRHH verifica
--    «no cumple» en un caso que resolvió la regla. Nunca dice «no cumple»: una regla
--    «no equivale» solo deja el requisito por confirmar.
-- 2. candidate_evaluation_items: de dónde sale cada valoración (motor, IA o regla
--    aprendida) y lo que había dicho el motor, para la explicación y la auditoría.
--    record_evaluation_core se redefine (idéntica a 20261028001200) solo para guardar
--    esas tres columnas.
-- =============================================================================

create table public.learned_equivalences (
  id uuid primary key default gen_random_uuid(),
  -- Requisito al que aplica: categoría + descripción normalizada (ver learned.ts).
  requirement_key text not null check (char_length(requirement_key) between 3 and 700),
  requirement_category public.requirement_category not null,
  requirement_description text not null check (char_length(requirement_description) between 1 and 600),
  -- Término del CV, normalizado (búsqueda) y tal como lo escribió el primer CV (para mostrar).
  cv_term text not null check (char_length(cv_term) between 2 and 80),
  cv_term_display text not null check (char_length(cv_term_display) between 2 and 80),
  -- Lo que se aprendió: nulo mientras se juntan votos.
  verdict text check (verdict in ('equivale', 'no_equivale')),
  status text not null default 'aprendiendo'
    check (status in ('aprendiendo', 'pendiente_juez', 'activa', 'rechazada', 'suspendida')),
  status_reason text,
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles (id) on delete set null,
  votes_yes integer not null default 0,
  votes_no integer not null default 0,
  -- Segundo juez.
  judge_model text,
  judge_equivalent boolean,
  judge_reason text,
  judged_at timestamptz,
  judge_token uuid,
  judge_claimed_at timestamptz,
  judge_attempts integer not null default 0,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_key, cv_term)
);

create index learned_equivalences_active_idx on public.learned_equivalences (requirement_key) where status = 'activa';
create index learned_equivalences_judge_idx on public.learned_equivalences (updated_at) where status = 'pendiente_juez';

-- Un voto por candidato (CV distintos): lo que dijo la IA la última vez.
create table public.learned_equivalence_votes (
  equivalence_id uuid not null references public.learned_equivalences (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  equivalent boolean not null,
  rationale text not null default '' check (char_length(rationale) <= 600),
  created_at timestamptz not null default now(),
  primary key (equivalence_id, candidate_id)
);

create trigger learned_equivalences_audit after insert or update or delete on public.learned_equivalences
  for each row execute function private.audit_row_change();

alter table public.learned_equivalences enable row level security;
alter table public.learned_equivalence_votes enable row level security;

-- Las reglas son conocimiento del motor, no datos de candidatos: el personal las ve.
create policy learned_equivalences_select on public.learned_equivalences
  for select to authenticated using (private.is_staff());
-- Los votos se vinculan a candidatos: solo administración.
create policy learned_equivalence_votes_select on public.learned_equivalence_votes
  for select to authenticated using (private.is_admin());

revoke all on table public.learned_equivalences from anon, authenticated;
revoke all on table public.learned_equivalence_votes from anon, authenticated;
grant select on table public.learned_equivalences to authenticated;
grant select on table public.learned_equivalence_votes to authenticated;

-- -----------------------------------------------------------------------------
-- Ítems: de dónde sale cada valoración
-- -----------------------------------------------------------------------------
alter table public.candidate_evaluation_items
  add column resolved_by text check (resolved_by in ('ia', 'regla_aprendida')),
  add column engine_assessment public.requirement_assessment,
  add column learned_equivalence_id uuid references public.learned_equivalences (id) on delete set null;

-- -----------------------------------------------------------------------------
-- record_evaluation_core: igual que en 20261028001200_interviews_hardening.sql,
-- más las columnas resolved_by, engine_assessment y learned_equivalence_id.
-- -----------------------------------------------------------------------------
create or replace function private.record_evaluation_core(
  p_application_id uuid,
  p_resume_id uuid,
  p_criteria_version integer,
  p_method public.evaluation_method,
  p_method_version text,
  p_scoring_version text,
  p_model text,
  p_score numeric,
  p_score_potential numeric,
  p_evidence_coverage numeric,
  p_level public.compatibility_level,
  p_summary text,
  p_limitations text[],
  p_input_sha256 text,
  p_items jsonb,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_vacancy public.vacancies%rowtype;
  v_eval_id uuid;
  v_expected integer;
  v_matched integer;
  v_total numeric;
  v_score numeric;
  v_potential numeric;
  v_coverage numeric;
  v_unknown numeric;
  v_mandatory_not_met boolean;
  v_level public.compatibility_level;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found then
    raise exception 'Postulación no encontrada' using errcode = 'RH404';
  end if;

  select * into v_vacancy from public.vacancies where id = v_app.vacancy_id for share;
  if v_vacancy.criteria_approved_at is null then
    raise exception 'Los criterios de la vacante no están aprobados' using errcode = 'RH409';
  end if;
  if v_vacancy.criteria_version <> p_criteria_version then
    raise exception 'La versión de criterios no coincide con la vigente' using errcode = 'RH409';
  end if;

  if p_resume_id is not null and not exists (
    select 1 from public.resumes r
    where r.id = p_resume_id and r.candidate_id = v_app.candidate_id
  ) then
    raise exception 'El CV no pertenece al candidato' using errcode = 'RH422';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Formato de ítems inválido' using errcode = 'RH422';
  end if;

  select count(*) into v_expected
  from public.vacancy_requirements
  where vacancy_id = v_vacancy.id;

  select count(distinct r.id) into v_matched
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r
    on r.id = private.try_uuid(i ->> 'requirement_id')
   and r.vacancy_id = v_vacancy.id;

  if v_expected = 0 or v_matched <> v_expected or jsonb_array_length(p_items) <> v_expected then
    raise exception 'La evaluación debe cubrir exactamente los requisitos vigentes' using errcode = 'RH422';
  end if;

  -- Las verificaciones de RRHH prevalecen: la valoración de un requisito
  -- verificado debe coincidir con el resultado registrado, y debe indicar qué
  -- dijo el CV (cv_assessment) para conservarlo.
  if exists (
    select 1
    from jsonb_array_elements(p_items) i
    join public.requirement_verifications v
      on v.application_id = v_app.id
     and v.requirement_id = private.try_uuid(i ->> 'requirement_id')
    where i ->> 'assessment' is distinct from v.result::text
  ) then
    raise exception 'La evaluación no respeta las verificaciones registradas' using errcode = 'RH422';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) i
    join public.requirement_verifications v
      on v.application_id = v_app.id
     and v.requirement_id = private.try_uuid(i ->> 'requirement_id')
    where (i ->> 'cv_assessment') is null
       or (i ->> 'cv_assessment') not in (select unnest(enum_range(null::public.requirement_assessment))::text)
  ) then
    raise exception 'Falta la valoración original del CV de un requisito verificado' using errcode = 'RH422';
  end if;

  -- Recalcula los porcentajes con los pesos almacenados.
  select
    sum(r.weight),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' = 'acreditado'),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' <> 'no_cumplido'),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' in ('acreditado', 'no_cumplido')),
    100.0 * sum(r.weight) filter (where i ->> 'assessment' in ('sin_evidencia', 'pendiente_verificacion')),
    coalesce(bool_or(r.priority = 'obligatorio' and i ->> 'assessment' = 'no_cumplido'), false)
  into v_total, v_score, v_potential, v_coverage, v_unknown, v_mandatory_not_met
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r on r.id = private.try_uuid(i ->> 'requirement_id');

  v_score := round(coalesce(v_score, 0) / v_total, 2);
  v_potential := round(coalesce(v_potential, 0) / v_total, 2);
  v_coverage := round(coalesce(v_coverage, 0) / v_total, 2);
  v_unknown := round(coalesce(v_unknown, 0) / v_total, 2);

  if abs(v_score - p_score) > 0.01
     or abs(v_potential - p_score_potential) > 0.01
     or abs(v_coverage - p_evidence_coverage) > 0.01 then
    raise exception 'Los porcentajes no coinciden con la metodología de puntuación' using errcode = 'RH422';
  end if;

  -- Nivel orientativo con las mismas reglas que determineLevel (scoring.ts).
  v_level := case
    when v_unknown > 50 then 'pendiente'
    when v_score >= 70 and not v_mandatory_not_met then 'alta'
    when v_score >= 40 then 'parcial'
    else 'baja'
  end;
  if v_level <> p_level then
    raise exception 'El nivel no coincide con la metodología de puntuación' using errcode = 'RH422';
  end if;

  insert into public.candidate_evaluations (
    application_id, resume_id, criteria_version, method, method_version,
    scoring_version, model, score, score_potential, evidence_coverage, level,
    summary, limitations, input_sha256, created_by
  )
  values (
    v_app.id, p_resume_id, p_criteria_version, p_method, p_method_version,
    p_scoring_version, p_model, v_score, v_potential, v_coverage, v_level,
    p_summary, coalesce(p_limitations, '{}'), p_input_sha256, p_actor
  )
  returning id into v_eval_id;

  -- Los campos de verificación se copian de la tabla, nunca del cliente.
  insert into public.candidate_evaluation_items (
    evaluation_id, requirement_id, category, priority, description, weight,
    is_essential, assessment, evidence, rationale, position,
    cv_assessment, cv_rationale, verification_source, verification_note, verified_by, verified_at,
    resolved_by, engine_assessment, learned_equivalence_id
  )
  select
    v_eval_id,
    r.id,
    r.category,
    r.priority,
    r.description,
    r.weight,
    r.is_essential,
    (i ->> 'assessment')::public.requirement_assessment,
    coalesce(i -> 'evidence', '[]'::jsonb),
    left(coalesce(i ->> 'rationale', ''), 2000),
    r.position,
    case when v.id is not null then (i ->> 'cv_assessment')::public.requirement_assessment end,
    case when v.id is not null then nullif(left(i ->> 'cv_rationale', 2000), '') end,
    v.source,
    v.note,
    v.verified_by,
    v.verified_at,
    -- De dónde sale la valoración (20261118000200): motor (nulo), IA o regla aprendida.
    case when i ->> 'resolved_by' in ('ia', 'regla_aprendida') then i ->> 'resolved_by' end,
    case
      when i ->> 'resolved_by' in ('ia', 'regla_aprendida')
       and (i ->> 'engine_assessment') in (select unnest(enum_range(null::public.requirement_assessment))::text)
      then (i ->> 'engine_assessment')::public.requirement_assessment
    end,
    (select le.id from public.learned_equivalences le where le.id = private.try_uuid(i ->> 'learned_equivalence_id'))
  from jsonb_array_elements(p_items) i
  join public.vacancy_requirements r on r.id = private.try_uuid(i ->> 'requirement_id')
  left join public.requirement_verifications v
    on v.application_id = v_app.id and v.requirement_id = r.id;

  update public.applications
  set latest_evaluation_id = v_eval_id
  where id = v_app.id;

  insert into public.application_events (application_id, event_type, actor_id)
  values (v_app.id, 'evaluacion_generada', p_actor);

  return v_eval_id;
end
$$;


-- -----------------------------------------------------------------------------
-- Votos de la IA (solo el sistema: lo llama la app al recibir la respuesta del worker)
-- -----------------------------------------------------------------------------
create function public.learn_record_vote(
  p_requirement_key text,
  p_category public.requirement_category,
  p_description text,
  p_cv_term text,
  p_cv_term_display text,
  p_candidate_id uuid,
  p_application_id uuid,
  p_equivalent boolean,
  p_rationale text,
  p_min_confirmations integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_rule public.learned_equivalences%rowtype;
  v_yes integer;
  v_no integer;
  v_against boolean;
  v_status text;
begin
  if p_min_confirmations < 2 then
    raise exception 'Se necesitan al menos 2 confirmaciones' using errcode = 'RH422';
  end if;

  insert into public.learned_equivalences (requirement_key, requirement_category, requirement_description, cv_term, cv_term_display)
  values (p_requirement_key, p_category, left(p_description, 600), p_cv_term, left(p_cv_term_display, 80))
  on conflict (requirement_key, cv_term) do update set updated_at = now()
  returning id into v_id;

  insert into public.learned_equivalence_votes (equivalence_id, candidate_id, application_id, equivalent, rationale)
  values (v_id, p_candidate_id, p_application_id, p_equivalent, left(coalesce(p_rationale, ''), 600))
  on conflict (equivalence_id, candidate_id) do update
    set equivalent = excluded.equivalent,
        rationale = excluded.rationale,
        application_id = excluded.application_id,
        created_at = now();

  select count(*) filter (where equivalent), count(*) filter (where not equivalent)
  into v_yes, v_no
  from public.learned_equivalence_votes
  where equivalence_id = v_id;

  select * into v_rule from public.learned_equivalences where id = v_id for update;
  v_against := (v_rule.verdict = 'equivale' and not p_equivalent) or (v_rule.verdict = 'no_equivale' and p_equivalent);

  update public.learned_equivalences
  set votes_yes = v_yes,
      votes_no = v_no,
      updated_at = now(),
      verdict = case
        when status = 'aprendiendo' and v_yes >= p_min_confirmations and v_no = 0 then 'equivale'
        when status = 'aprendiendo' and v_no >= p_min_confirmations and v_yes = 0 then 'no_equivale'
        when status = 'pendiente_juez' and v_against then null
        else verdict
      end,
      status = case
        when status = 'aprendiendo' and ((v_yes >= p_min_confirmations and v_no = 0) or (v_no >= p_min_confirmations and v_yes = 0))
          then 'pendiente_juez'
        when status = 'pendiente_juez' and v_against then 'aprendiendo'
        when status = 'activa' and v_against then 'suspendida'
        else status
      end,
      status_reason = case
        when status = 'activa' and v_against then 'La IA opinó lo contrario en otro CV.'
        when status = 'pendiente_juez' and v_against then 'La IA opinó lo contrario en otro CV antes del segundo juez.'
        else status_reason
      end,
      status_changed_at = case
        when (status = 'aprendiendo' and ((v_yes >= p_min_confirmations and v_no = 0) or (v_no >= p_min_confirmations and v_yes = 0)))
          or (status in ('pendiente_juez', 'activa') and v_against)
          then now()
        else status_changed_at
      end,
      status_changed_by = case when status in ('pendiente_juez', 'activa') and v_against then null else status_changed_by end,
      judge_token = case when status = 'pendiente_juez' and v_against then null else judge_token end,
      judge_claimed_at = case when status = 'pendiente_juez' and v_against then null else judge_claimed_at end
  where id = v_id
  returning status into v_status;

  return v_status;
end
$$;

revoke all on function public.learn_record_vote(text, public.requirement_category, text, text, text, uuid, uuid, boolean, text, integer)
  from public, anon, authenticated;
grant execute on function public.learn_record_vote(text, public.requirement_category, text, text, text, uuid, uuid, boolean, text, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- Segundo juez (lo ejecuta el worker de IA como un trabajo más, con otro modelo)
-- -----------------------------------------------------------------------------
create function public.learn_claim_judgment()
returns table (
  equivalence_id uuid,
  judge_token uuid,
  attempts integer,
  requirement_category public.requirement_category,
  requirement_description text,
  cv_term_display text,
  verdict text,
  votes integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select l.id into v_id
  from public.learned_equivalences l
  where l.status = 'pendiente_juez'
    and l.judge_attempts < 5
    and (l.judge_claimed_at is null or l.judge_claimed_at < now() - interval '10 minutes')
  order by l.updated_at
  limit 1
  for update skip locked;
  if v_id is null then
    return;
  end if;

  return query
  update public.learned_equivalences l
  set judge_token = gen_random_uuid(),
      judge_claimed_at = now(),
      judge_attempts = l.judge_attempts + 1
  where l.id = v_id
  returning l.id, l.judge_token, l.judge_attempts, l.requirement_category, l.requirement_description, l.cv_term_display,
            l.verdict, greatest(l.votes_yes, l.votes_no);
end
$$;

create function public.learn_report_judgment(
  p_id uuid,
  p_token uuid,
  p_equivalent boolean,
  p_reason text,
  p_model text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.learned_equivalences%rowtype;
  v_agrees boolean;
begin
  select * into v_rule from public.learned_equivalences where id = p_id for update;
  if not found or v_rule.status <> 'pendiente_juez' or v_rule.judge_token is distinct from p_token then
    return 'ignorado';
  end if;
  v_agrees := p_equivalent = (v_rule.verdict = 'equivale');

  update public.learned_equivalences
  set judge_model = left(p_model, 100),
      judge_equivalent = p_equivalent,
      judge_reason = left(coalesce(p_reason, ''), 600),
      judged_at = now(),
      judge_token = null,
      judge_claimed_at = null,
      status = case when v_agrees then 'activa' else 'rechazada' end,
      status_reason = case
        when v_agrees then null
        else 'El segundo juez no estuvo de acuerdo con lo que vio la IA.'
      end,
      activated_at = case when v_agrees then now() else activated_at end,
      status_changed_at = now(),
      status_changed_by = null,
      updated_at = now()
  where id = p_id;

  return case when v_agrees then 'activa' else 'rechazada' end;
end
$$;

-- Límite del plan o error: la reserva se libera y se reintenta más tarde (los intentos ya contaron).
create function public.learn_release_judgment(p_id uuid, p_token uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.learned_equivalences
  set judge_token = null, judge_claimed_at = null, updated_at = now()
  where id = p_id and status = 'pendiente_juez' and judge_token = p_token;
$$;

revoke all on function public.learn_claim_judgment() from public, anon, authenticated;
revoke all on function public.learn_report_judgment(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.learn_release_judgment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.learn_claim_judgment() to service_role;
grant execute on function public.learn_report_judgment(uuid, uuid, boolean, text, text) to service_role;
grant execute on function public.learn_release_judgment(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Administración: desactivar o reactivar una regla (deshacer)
-- -----------------------------------------------------------------------------
create function public.set_learned_equivalence_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.learned_equivalences%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede cambiar lo que aprendió el motor' using errcode = 'RH403';
  end if;
  select * into v_rule from public.learned_equivalences where id = p_id for update;
  if not found then
    raise exception 'Regla no encontrada' using errcode = 'RH404';
  end if;
  if p_active then
    if v_rule.verdict is null or v_rule.status not in ('suspendida', 'rechazada') then
      raise exception 'Solo se puede reactivar una regla suspendida o rechazada' using errcode = 'RH409';
    end if;
  elsif v_rule.status <> 'activa' then
    raise exception 'Solo se puede desactivar una regla activa' using errcode = 'RH409';
  end if;

  update public.learned_equivalences
  set status = case when p_active then 'activa' else 'suspendida' end,
      status_reason = case when p_active then 'Reactivada por administración.' else 'Desactivada por administración.' end,
      activated_at = case when p_active then now() else activated_at end,
      status_changed_at = now(),
      status_changed_by = auth.uid(),
      updated_at = now()
  where id = p_id;
end
$$;

revoke all on function public.set_learned_equivalence_active(uuid, boolean) from public, anon;
grant execute on function public.set_learned_equivalence_active(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- RRHH contradice una regla: verificó «no cumple» en un requisito que la regla acreditó
-- -----------------------------------------------------------------------------
create function private.suspend_learned_on_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result::text <> 'no_cumplido' then
    return new;
  end if;
  update public.learned_equivalences l
  set status = 'suspendida',
      status_reason = 'RRHH verificó «no cumple» en un caso que la regla había acreditado.',
      status_changed_at = now(),
      status_changed_by = null,
      updated_at = now()
  where l.status = 'activa'
    and l.verdict = 'equivale'
    and l.id in (
      select i.learned_equivalence_id
      from public.applications a
      join public.candidate_evaluation_items i on i.evaluation_id = a.latest_evaluation_id
      where a.id = new.application_id
        and i.requirement_id = new.requirement_id
        and i.resolved_by = 'regla_aprendida'
        and i.learned_equivalence_id is not null
    );
  return new;
end
$$;

create trigger requirement_verifications_suspend_learned
after insert or update of result on public.requirement_verifications
for each row execute function private.suspend_learned_on_verification();
