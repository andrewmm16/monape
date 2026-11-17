-- =============================================================================
-- Correo de invitación de la base de talentos: editable y con respuestas
--
--  * email_templates acepta la clave 'invitacion_cartera': RRHH edita desde
--    Configuración el texto de la invitación, como los demás correos.
--  * email_settings guarda a qué dirección llegan las respuestas de los
--    candidatos (cabecera Reply-To). El remitente técnico suele ser una
--    dirección que no recibe correo: sin esto, quien responde a una invitación
--    no llega a nadie. Una sola fila; la gestiona el personal de RRHH.
-- =============================================================================

alter table public.email_templates drop constraint email_templates_key_valid;
alter table public.email_templates add constraint email_templates_key_valid
  check (key in ('entrevista_programada', 'seleccionado', 'no_seleccionado', 'invitacion_cartera'));

create table public.email_settings (
  -- Una única fila: la clave es siempre true.
  id boolean primary key default true check (id),
  reply_to text check (
    reply_to is null
    or (char_length(reply_to) <= 254 and reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger email_settings_set_updated_at before update on public.email_settings
  for each row execute function private.set_updated_at();
create trigger email_settings_set_actor before insert or update on public.email_settings
  for each row execute function private.set_actor_column('updated_by');
create trigger email_settings_audit after insert or update or delete on public.email_settings
  for each row execute function private.audit_row_change();

alter table public.email_settings enable row level security;

create policy email_settings_select on public.email_settings
  for select to authenticated using (private.is_staff());
create policy email_settings_insert on public.email_settings
  for insert to authenticated with check (private.is_staff());
create policy email_settings_update on public.email_settings
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

revoke all on table public.email_settings from anon, authenticated;
grant select on table public.email_settings to authenticated;
grant insert (reply_to) on table public.email_settings to authenticated;
grant update (reply_to) on table public.email_settings to authenticated;
