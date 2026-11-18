-- =============================================================================
-- Aprendizaje del motor: el segundo juez decide (calibración del 18/11/2026).
--
-- Medido con la app real: Haiku (la IA de cada CV) votó al revés en los dos cargos
-- de obra («Asistente de Residencia» no cuenta, «Maestro de Obra» sí) y Opus, como
-- juez a ciegas, decidió bien ambos. Con el diseño anterior, el voto errado hacía que
-- el juez «rechazara» la regla y se perdía lo que Opus había decidido bien; y un solo
-- voto en contra de Haiku suspendía una regla correcta. Ahora (pedido de Omar:
-- apoyarse en la IA para decidir si algo cuenta como experiencia):
--  - con el mínimo de votos (AI_LEARN_MIN_CONFIRMATIONS, 1 por defecto) se consulta
--    al juez, aunque los votos no coincidan: los votos solo dicen que el término
--    aparece en CV reales y merece una regla;
--  - lo que decide el juez es lo que el motor aprende (aunque difiera de los votos);
--  - los votos en contra de la IA ya no suspenden una regla activa (un error
--    sistemático de Haiku tumbaría una regla correcta de Opus): se cuentan y se
--    muestran en Configuración → Aprendizaje del motor. La suspenden RRHH (verifica
--    «no cumple» en un caso que la regla acreditó: trigger de 20261118000200) o
--    administración.
-- =============================================================================

create or replace function public.learn_record_vote(
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
  v_yes integer;
  v_no integer;
  v_status text;
begin
  if p_min_confirmations < 1 then
    raise exception 'Se necesita al menos 1 confirmación' using errcode = 'RH422';
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

  perform 1 from public.learned_equivalences where id = v_id for update;

  update public.learned_equivalences
  set votes_yes = v_yes,
      votes_no = v_no,
      updated_at = now(),
      -- Veredicto provisional (la mayoría) hasta que decida el juez.
      verdict = case
        when status = 'aprendiendo' and v_yes + v_no >= p_min_confirmations
          then case when v_yes >= v_no then 'equivale' else 'no_equivale' end
        else verdict
      end,
      status = case
        when status = 'aprendiendo' and v_yes + v_no >= p_min_confirmations then 'pendiente_juez'
        else status
      end,
      status_changed_at = case
        when status = 'aprendiendo' and v_yes + v_no >= p_min_confirmations then now()
        else status_changed_at
      end
  where id = v_id
  returning status into v_status;

  return v_status;
end
$$;

-- El juez decide: lo que dice es lo que el motor aprende, coincida o no con los votos.
create or replace function public.learn_report_judgment(
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
  v_verdict text := case when p_equivalent then 'equivale' else 'no_equivale' end;
begin
  select * into v_rule from public.learned_equivalences where id = p_id for update;
  if not found or v_rule.status <> 'pendiente_juez' or v_rule.judge_token is distinct from p_token then
    return 'ignorado';
  end if;

  update public.learned_equivalences
  set judge_model = left(p_model, 100),
      judge_equivalent = p_equivalent,
      judge_reason = left(coalesce(p_reason, ''), 600),
      judged_at = now(),
      judge_token = null,
      judge_claimed_at = null,
      verdict = v_verdict,
      status = 'activa',
      status_reason = case
        when v_rule.verdict is distinct from v_verdict then 'El segundo juez decidió distinto que la IA del CV: manda el juez.'
        else null
      end,
      activated_at = now(),
      status_changed_at = now(),
      status_changed_by = null,
      updated_at = now()
  where id = p_id;

  return 'activa';
end
$$;
