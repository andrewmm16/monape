-- =============================================================================
-- 0038 · Preguntas eliminatorias: lectura pública
-- =============================================================================
-- El formulario público necesita mostrar las preguntas, pero NUNCA lo que
-- «aprueba»: no se exponen expected_boolean, comparator, threshold ni
-- accepted_options. Para opcion_unica se devuelven las opciones (todas).
-- Mismo criterio de visibilidad que public_vacancy_requirements.
-- =============================================================================

create function public.public_killer_questions(p_code text)
returns table (
  id uuid,
  question text,
  question_type public.killer_question_type,
  help_text text,
  is_required boolean,
  options text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.question, q.question_type, q.help_text, q.is_required,
         case when q.question_type = 'opcion_unica' then q.options else null end
    from public.vacancies v
    join public.vacancy_killer_questions q on q.vacancy_id = v.id
   where v.public_code = p_code
     and v.first_published_at is not null
     and not v.is_confidential
     and (v.status = 'cerrada' or (v.status = 'publicada' and private.vacancy_has_public_data(v)))
   order by q.position, q.created_at
$$;

revoke all on function public.public_killer_questions(text) from public, anon, authenticated;
grant execute on function public.public_killer_questions(text) to service_role;
