-- =============================================================================
-- 0019 · Reclutador Caleta · prospectos de sourcing
--
-- Prospectos localizados de forma proactiva (LinkedIn X-Ray, CIP, grupos) para
-- una vacante concreta. NO son postulantes: son perfiles que RRHH encontró y
-- aún no han dado su consentimiento. Por eso viven en su propia tabla y no en
-- `candidates`; el teléfono y el correo son nullable y se completan recién en el
-- momento del contacto (dato consentido), nunca cosechados en frío.
--
-- El texto del perfil (profile_text) lo pega RRHH para puntuarlo con el motor de
-- reglas (evaluateWithRules) contra los requisitos de la vacante. Al confirmarse
-- el interés, el prospecto se deriva al flujo normal creando un `candidates` y
-- enlazándolo en candidate_id.
-- =============================================================================

create type public.caleta_source as enum (
  'linkedin', 'cip', 'grupo', 'google', 'referido', 'otro'
);

-- Embudo de contacto del prospecto.
create type public.caleta_status as enum (
  'encontrado',   -- localizado, aún sin contactar
  'contactado',   -- se le escribió (p. ej. invitación de LinkedIn)
  'respondio',    -- respondió al primer contacto
  'interesado',   -- manifestó interés en el puesto
  'descartado',   -- no cumple o no interesa (requiere motivo en notas)
  'derivado'      -- convertido en candidato formal (candidate_id)
);

-- -----------------------------------------------------------------------------
-- Prospectos
-- -----------------------------------------------------------------------------
create table public.caleta_prospects (
  id uuid primary key default gen_random_uuid(),
  -- Puesto para el que se busca. Si se archiva la vacante, se eliminan sus
  -- prospectos de sourcing (datos de trabajo, no expediente formal).
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 160),
  -- Titular/cargo del perfil (p. ej. "Ingeniero Sanitario | SEDAPAL").
  headline text check (char_length(headline) <= 300),
  location text check (char_length(location) <= 160),
  linkedin_url text check (char_length(linkedin_url) <= 300),
  source public.caleta_source not null default 'linkedin',
  source_detail text check (char_length(source_detail) <= 200),
  -- Texto del perfil pegado por RRHH, usado para puntuar con el motor de reglas.
  profile_text text check (char_length(profile_text) <= 200000),
  email text check (
    email is null
    or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  -- Se completa en el contacto (dato declarado por la persona), no por scraping.
  phone text check (char_length(phone) <= 40),
  -- Origen de cada dato: {"phone": "declarado", "email": "extraido", ...}
  field_origins jsonb not null default '{}'::jsonb
    check (private.is_valid_origin_map(field_origins)),
  status public.caleta_status not null default 'encontrado',
  -- Puntuación del motor de reglas sobre profile_text (0-100) y detalle por
  -- requisito (instantánea; la evaluación viva vive en candidate_evaluations
  -- una vez derivado el candidato).
  score integer check (score between 0 and 100),
  score_detail jsonb check (score_detail is null or jsonb_typeof(score_detail) = 'object'),
  scoring_version text check (char_length(scoring_version) <= 40),
  scored_at timestamptz,
  -- Candidato formal creado al derivar el prospecto al flujo normal.
  candidate_id uuid references public.candidates (id) on delete set null,
  notes text check (char_length(notes) <= 4000),
  email_normalized text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone_normalized text generated always as (private.normalize_phone(phone)) stored,
  name_normalized text generated always as (private.normalize_person_name(full_name)) stored,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La fecha de puntuación acompaña siempre a un score.
  constraint caleta_prospects_scored_check
    check ((score is null) = (scored_at is null)),
  -- Derivado ⇔ tiene candidato enlazado.
  constraint caleta_prospects_derived_check
    check ((status = 'derivado') = (candidate_id is not null))
);

create index caleta_prospects_vacancy_status_idx
  on public.caleta_prospects (vacancy_id, status);
create index caleta_prospects_phone_normalized_idx
  on public.caleta_prospects (phone_normalized);
create index caleta_prospects_name_normalized_idx
  on public.caleta_prospects (name_normalized);
create index caleta_prospects_candidate_idx
  on public.caleta_prospects (candidate_id);
create index caleta_prospects_created_at_idx
  on public.caleta_prospects (created_at desc);

-- Evita prospectar dos veces el mismo perfil de LinkedIn para la misma vacante.
create unique index caleta_prospects_vacancy_linkedin_idx
  on public.caleta_prospects (vacancy_id, linkedin_url)
  where linkedin_url is not null;

-- -----------------------------------------------------------------------------
-- Disparadores: updated_at, autoría y auditoría (mismas convenciones del esquema)
-- -----------------------------------------------------------------------------
create trigger caleta_prospects_set_updated_at
  before update on public.caleta_prospects
  for each row execute function private.set_updated_at();

create trigger caleta_prospects_set_created_by
  before insert on public.caleta_prospects
  for each row execute function private.set_actor_column('created_by');

create trigger caleta_prospects_audit
  after insert or update or delete on public.caleta_prospects
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS y privilegios. Datos de trabajo interno de RRHH: solo el personal (admin
-- y rrhh) los ve y gestiona; solo un administrador los elimina.
-- -----------------------------------------------------------------------------
alter table public.caleta_prospects enable row level security;

create policy caleta_prospects_select on public.caleta_prospects
  for select to authenticated using (private.is_staff());
create policy caleta_prospects_insert on public.caleta_prospects
  for insert to authenticated with check (private.is_staff());
create policy caleta_prospects_update on public.caleta_prospects
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy caleta_prospects_delete on public.caleta_prospects
  for delete to authenticated using (private.is_admin());

revoke all on table public.caleta_prospects from anon, authenticated;
grant select, delete on table public.caleta_prospects to authenticated;
grant insert (
  vacancy_id, full_name, headline, location, linkedin_url, source, source_detail,
  profile_text, email, phone, field_origins, status, score, score_detail,
  scoring_version, scored_at, candidate_id, notes
) on table public.caleta_prospects to authenticated;
grant update (
  full_name, headline, location, linkedin_url, source, source_detail,
  profile_text, email, phone, field_origins, status, score, score_detail,
  scoring_version, scored_at, candidate_id, notes
) on table public.caleta_prospects to authenticated;
