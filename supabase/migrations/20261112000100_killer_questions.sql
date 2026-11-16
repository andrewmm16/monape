-- =============================================================================
-- 0037 · Preguntas eliminatorias (killer questions)
-- =============================================================================
-- Preguntas de respuesta cerrada que el candidato responde AL postular, sobre
-- requisitos indispensables y objetivos que no se pueden inferir del CV
-- (residencia, licencias, disponibilidad, pretensión salarial, años declarados).
--
-- PRINCIPIO RECTOR: la plataforma nunca descarta a nadie sola. Estas preguntas
-- MARCAN al candidato ("no cumple un requisito excluyente") pero NUNCA lo
-- eliminan ni cambian el estado de la postulación. La marca (`meets = false`) es
-- informativa; RRHH decide. Mismo molde que `possible_duplicate_reasons` y el
-- enum `requirement_assessment` ('no_cumplido' informa, no descarta).
-- =============================================================================

create type public.killer_question_type as enum ('si_no', 'numero', 'opcion_unica');
create type public.killer_number_comparator as enum ('mayor_igual', 'menor_igual', 'igual');

-- -----------------------------------------------------------------------------
-- Definición de preguntas por vacante (tabla independiente: NO dispara
-- reset_criteria_approval, porque no son criterios de evaluación del CV).
-- Vínculo opcional a un requisito evaluable por si se quiere relacionar.
-- -----------------------------------------------------------------------------
create table public.vacancy_killer_questions (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  requirement_id uuid references public.vacancy_requirements (id) on delete set null,
  question text not null check (char_length(question) between 5 and 300),
  question_type public.killer_question_type not null,
  -- Ayuda opcional que ve el candidato (no revela qué respuesta "aprueba").
  help_text text check (help_text is null or char_length(help_text) <= 300),
  is_required boolean not null default true,
  -- Condición aceptable (según el tipo; validada por el check de forma):
  --  · si_no        → expected_boolean (true = la respuesta que aprueba es "Sí")
  --  · numero       → comparator + threshold
  --  · opcion_unica → options (todas) + accepted_options (las que aprueban)
  expected_boolean boolean,
  comparator public.killer_number_comparator,
  threshold numeric(12, 2),
  options text[],
  accepted_options text[],
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint killer_question_shape check (
    case question_type
      when 'si_no' then
        expected_boolean is not null
        and comparator is null and threshold is null
        and options is null and accepted_options is null
      when 'numero' then
        comparator is not null and threshold is not null
        and expected_boolean is null
        and options is null and accepted_options is null
      when 'opcion_unica' then
        options is not null and cardinality(options) between 2 and 20
        and accepted_options is not null and cardinality(accepted_options) between 1 and 20
        and accepted_options <@ options
        and expected_boolean is null and comparator is null and threshold is null
    end
  )
);

create index vacancy_killer_questions_vacancy_idx
  on public.vacancy_killer_questions (vacancy_id, position);

-- -----------------------------------------------------------------------------
-- Respuestas declaradas del candidato (inmutables). `meets` lo calcula la BD
-- por trigger a partir de la pregunta y la respuesta; el cliente no lo decide.
-- -----------------------------------------------------------------------------
create table public.application_killer_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  question_id uuid not null references public.vacancy_killer_questions (id) on delete cascade,
  -- Respuesta declarada (se usa la columna correspondiente al tipo de pregunta):
  answer_boolean boolean,
  answer_number numeric(12, 2),
  answer_text text check (answer_text is null or char_length(answer_text) <= 200),
  -- ¿La respuesta cumple la condición excluyente? Lo fija el trigger.
  meets boolean not null,
  created_at timestamptz not null default now(),
  unique (application_id, question_id)
);

create index application_killer_answers_application_idx
  on public.application_killer_answers (application_id);
create index application_killer_answers_question_idx
  on public.application_killer_answers (question_id);

-- -----------------------------------------------------------------------------
-- La BD es la fuente de verdad del "cumple / no cumple". Valida que la pregunta
-- pertenezca a la vacante de la postulación y recalcula `meets`.
-- -----------------------------------------------------------------------------
create function private.compute_killer_answer_meets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.vacancy_killer_questions%rowtype;
begin
  select * into q from public.vacancy_killer_questions where id = new.question_id;
  if not found then
    raise exception 'Pregunta eliminatoria no encontrada' using errcode = 'RH404';
  end if;

  -- La pregunta tiene que ser de la misma vacante que la postulación.
  if not exists (
    select 1 from public.applications a
    where a.id = new.application_id and a.vacancy_id = q.vacancy_id
  ) then
    raise exception 'La pregunta no corresponde a la vacante de la postulación'
      using errcode = 'RH422';
  end if;

  if q.question_type = 'si_no' then
    if new.answer_boolean is null then
      raise exception 'Falta la respuesta Sí/No' using errcode = 'RH422';
    end if;
    new.answer_number := null;
    new.answer_text := null;
    new.meets := (new.answer_boolean = q.expected_boolean);

  elsif q.question_type = 'numero' then
    if new.answer_number is null then
      raise exception 'Falta la respuesta numérica' using errcode = 'RH422';
    end if;
    new.answer_boolean := null;
    new.answer_text := null;
    new.meets := case q.comparator
      when 'mayor_igual' then new.answer_number >= q.threshold
      when 'menor_igual' then new.answer_number <= q.threshold
      when 'igual' then new.answer_number = q.threshold
    end;

  else -- opcion_unica
    if new.answer_text is null then
      raise exception 'Falta la opción seleccionada' using errcode = 'RH422';
    end if;
    if not (new.answer_text = any (q.options)) then
      raise exception 'La opción seleccionada no es válida' using errcode = 'RH422';
    end if;
    new.answer_boolean := null;
    new.answer_number := null;
    new.meets := (new.answer_text = any (q.accepted_options));
  end if;

  return new;
end
$$;

create trigger application_killer_answers_compute_meets
  before insert on public.application_killer_answers
  for each row execute function private.compute_killer_answer_meets();

-- -----------------------------------------------------------------------------
-- Disparadores
-- -----------------------------------------------------------------------------
create trigger vacancy_killer_questions_set_updated_at
  before update on public.vacancy_killer_questions
  for each row execute function private.set_updated_at();

create trigger vacancy_killer_questions_audit
  after insert or update or delete on public.vacancy_killer_questions
  for each row execute function private.audit_row_change();

create trigger application_killer_answers_audit
  after insert or delete on public.application_killer_answers
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
alter table public.vacancy_killer_questions enable row level security;
alter table public.application_killer_answers enable row level security;

-- Preguntas: RRHH/admin gestionan; quien accede a la vacante, lee.
create policy vacancy_killer_questions_select on public.vacancy_killer_questions
  for select to authenticated
  using (private.can_access_vacancy(vacancy_id));

create policy vacancy_killer_questions_insert on public.vacancy_killer_questions
  for insert to authenticated
  with check (private.is_staff());

create policy vacancy_killer_questions_update on public.vacancy_killer_questions
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff());

create policy vacancy_killer_questions_delete on public.vacancy_killer_questions
  for delete to authenticated
  using (private.is_staff());

-- Respuestas: solo lectura para quien accede a la postulación. La escritura la
-- hace el formulario público vía RPC (service_role), nunca el cliente directo.
create policy application_killer_answers_select on public.application_killer_answers
  for select to authenticated
  using (private.can_access_application(application_id));

revoke all on table public.vacancy_killer_questions from anon, authenticated;
grant select, delete on table public.vacancy_killer_questions to authenticated;
grant insert (
  vacancy_id, requirement_id, question, question_type, help_text, is_required,
  expected_boolean, comparator, threshold, options, accepted_options, position
) on table public.vacancy_killer_questions to authenticated;
grant update (
  requirement_id, question, question_type, help_text, is_required,
  expected_boolean, comparator, threshold, options, accepted_options, position
) on table public.vacancy_killer_questions to authenticated;

revoke all on table public.application_killer_answers from anon, authenticated;
grant select on table public.application_killer_answers to authenticated;
