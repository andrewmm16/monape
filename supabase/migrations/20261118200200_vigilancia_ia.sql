-- =============================================================================
-- Vigilancia semanal de la IA: cada semana el worker mide al modelo de los CV
-- contra la vara del banco de CV ficticios (`npm run vigilar:ia`, que corre
-- medir:ia) y envía el resumen a la app (POST /api/ia/vigilancia). La app lo
-- guarda aquí y, si el acierto baja, avisa por correo a administración.
-- Son cifras agregadas sobre CV ficticios: no hay datos de candidatos.
-- =============================================================================

create table public.ai_quality_checks (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  model text not null check (char_length(model) between 1 and 100),
  prompt_version text not null check (prompt_version ~ '^[a-z0-9.\-]{1,40}$'),
  cv_count integer not null check (cv_count between 0 and 10000),
  failures integer not null check (failures between 0 and 10000),
  order_inversions integer not null default 0 check (order_inversions between 0 and 10000),
  cells integer not null check (cells between 0 and 100000),
  -- Aciertos contra la vara, de 0 a 1.
  accuracy_engine numeric(5, 4) check (accuracy_engine between 0 and 1),
  accuracy_ai numeric(5, 4) check (accuracy_ai between 0 and 1),
  accuracy_relay numeric(5, 4) check (accuracy_relay between 0 and 1),
  -- Motor + IA contando «pendiente» = «sin evidencia» (mismo efecto en el puntaje).
  accuracy_relay_lenient numeric(5, 4) check (accuracy_relay_lenient between 0 and 1),
  -- El error más caro: la IA acreditó lo que la vara no acredita.
  ai_over_accredited integer not null check (ai_over_accredited between 0 and 100000),
  seconds_per_cv numeric(6, 1) check (seconds_per_cv >= 0),
  status text not null check (status in ('ok', 'alerta')),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 20)
);

create index ai_quality_checks_recent_idx on public.ai_quality_checks (checked_at desc);

alter table public.ai_quality_checks enable row level security;

-- Calidad del servicio de IA: la ve administración (Configuración → Aprendizaje del motor).
create policy ai_quality_checks_select on public.ai_quality_checks
  for select to authenticated using (private.is_admin());

-- Solo el sistema (la API del worker, con la clave de servicio) registra revisiones.
revoke all on table public.ai_quality_checks from anon, authenticated;
grant select on table public.ai_quality_checks to authenticated;
