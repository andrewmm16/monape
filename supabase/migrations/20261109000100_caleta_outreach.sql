-- =============================================================================
-- 0020 · Reclutador Caleta · seguimiento del contacto saliente
--
-- Registra CUÁNDO, por QUÉ CANAL y con qué MENSAJE se contactó a cada prospecto,
-- para mapear a quién ya se escribió y respetar un ritmo seguro (p. ej. ~20
-- invitaciones de LinkedIn al día, para no gatillar restricciones de la cuenta).
-- El contacto se registra desde el panel al abrir el perfil; no hay envío en
-- frío automatizado.
-- =============================================================================

-- Canal por el que se hizo el primer contacto saliente.
create type public.caleta_contact_channel as enum ('linkedin', 'whatsapp', 'email', 'otro');

alter table public.caleta_prospects
  add column contact_channel public.caleta_contact_channel,
  add column contacted_at timestamptz,
  add column outreach_message text
    check (outreach_message is null or char_length(outreach_message) <= 4000);

comment on column public.caleta_prospects.contacted_at is
  'Momento del primer contacto saliente (LinkedIn/WhatsApp). Alimenta el conteo diario para cuidar el ritmo anti-baneo.';

-- Los privilegios del esquema son por columna: hay que concederlos para las nuevas.
grant insert (contact_channel, contacted_at, outreach_message)
  on table public.caleta_prospects to authenticated;
grant update (contact_channel, contacted_at, outreach_message)
  on table public.caleta_prospects to authenticated;
