-- =============================================================================
-- Plantillas de correo editables por RRHH
--
-- email_templates: asunto + cuerpo de los correos de cambio de estado que el
-- personal de RRHH puede editar desde Configuración. Si una clave no tiene
-- fila, el envío usa el texto por defecto del código (nada se rompe). El cuerpo
-- admite las variables {{nombre}}, {{vacante}} y {{empresa}}. No guarda datos
-- personales: es texto de plantilla, igual para todos los candidatos, y nunca
-- incluye el motivo ni las observaciones internas (eso lo garantiza el servidor).
-- Gestión: personal de RRHH (admin y rrhh), igual criterio que is_staff.
-- =============================================================================

create table public.email_templates (
  key text primary key
    constraint email_templates_key_valid
      check (key in ('entrevista_programada', 'seleccionado', 'no_seleccionado')),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger email_templates_set_updated_at before update on public.email_templates
  for each row execute function private.set_updated_at();
create trigger email_templates_set_actor before insert or update on public.email_templates
  for each row execute function private.set_actor_column('updated_by');
create trigger email_templates_audit after insert or update or delete on public.email_templates
  for each row execute function private.audit_row_change();

alter table public.email_templates enable row level security;

create policy email_templates_select on public.email_templates
  for select to authenticated using (private.is_staff());
create policy email_templates_insert on public.email_templates
  for insert to authenticated with check (private.is_staff());
create policy email_templates_update on public.email_templates
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy email_templates_delete on public.email_templates
  for delete to authenticated using (private.is_staff());

revoke all on table public.email_templates from anon, authenticated;
grant select on table public.email_templates to authenticated;
grant insert (key, subject, body) on table public.email_templates to authenticated;
grant update (subject, body) on table public.email_templates to authenticated;
grant delete on table public.email_templates to authenticated;
