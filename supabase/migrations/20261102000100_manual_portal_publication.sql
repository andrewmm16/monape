-- =============================================================================
-- Publicación a mano en portales
--
-- RRHH publica una oferta a mano en un portal y la registra aquí con el código
-- que muestra el portal, para que el lector de correo ligue los avisos de
-- postulación con la vacante.
--
-- * portal_publications.manual: la oferta la gestiona una persona, no el robot.
--   Nunca pasa por 'pendiente', 'publicando' ni 'retirar', así que
--   bot_claim_publication no la toma.
-- * mark_portal_published_manually / mark_portal_withdrawn_manually: RRHH
--   registra y retira. Errores: RH404 inexistente, RH409 estado que no lo
--   permite, RH422 dato no válido.
-- * Al cerrar o archivar la vacante, una publicación manual pasa directo a
--   'retirada' (no hay robot que la retire; RRHH la baja a mano en el portal).
-- * bot_list_active_publications sigue listando las manuales (el lector de
--   correo las busca por esa ruta) y ahora informa la columna `manual` para que
--   el robot no intente sincronizarlas.
-- =============================================================================

alter table public.portal_publications add column manual boolean not null default false;

-- -----------------------------------------------------------------------------
-- 1. RRHH: registrar una publicación hecha a mano
-- -----------------------------------------------------------------------------
create function public.mark_portal_published_manually(
  p_vacancy_id uuid,
  p_portal_id uuid,
  p_external_id text,
  p_external_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.vacancies%rowtype;
  v_portal public.job_portals%rowtype;
  v_existing public.portal_publications%rowtype;
  v_external_id text := btrim(p_external_id);
  v_external_url text := nullif(btrim(p_external_url), '');
  v_id uuid;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_vacancy from public.vacancies where id = p_vacancy_id;
  if not found then
    raise exception 'La vacante no existe' using errcode = 'RH404';
  end if;
  if v_vacancy.status <> 'publicada' then
    raise exception 'Solo se registran publicaciones de vacantes en estado publicada' using errcode = 'RH409';
  end if;

  select * into v_portal from public.job_portals where id = p_portal_id and is_active;
  if not found then
    raise exception 'El portal no existe o está inactivo' using errcode = 'RH404';
  end if;

  if v_external_id is null or char_length(v_external_id) not between 1 and 200 then
    raise exception 'El código de la oferta debe tener entre 1 y 200 caracteres' using errcode = 'RH422';
  end if;
  if v_external_url is not null and (char_length(v_external_url) > 500 or v_external_url !~ '^https://') then
    raise exception 'El enlace debe empezar por https:// y tener hasta 500 caracteres' using errcode = 'RH422';
  end if;

  select * into v_existing
  from public.portal_publications
  where vacancy_id = p_vacancy_id and portal_id = p_portal_id
  for update;

  if found then
    if v_existing.status in ('error', 'retirada') then
      -- Como en el flujo normal, lo anterior queda olvidado.
      update public.portal_publications
      set status = 'publicada', manual = true, external_id = v_external_id, external_url = v_external_url,
          error_code = null, attempts = 0, claimed_at = null, published_at = now(), last_synced_at = null,
          requested_by = (select auth.uid()), requested_at = now(), updated_at = now()
      where id = v_existing.id;
    elsif v_existing.status = 'publicada' and v_existing.manual then
      -- Corregir un código o enlace mal escrito.
      update public.portal_publications
      set external_id = v_external_id, external_url = v_external_url, updated_at = now()
      where id = v_existing.id;
    else
      raise exception 'El robot gestiona la publicación de este portal' using errcode = 'RH409';
    end if;
    v_id := v_existing.id;
  else
    insert into public.portal_publications (
      vacancy_id, portal_id, status, manual, external_id, external_url, published_at, requested_by
    )
    values (
      p_vacancy_id, p_portal_id, 'publicada', true, v_external_id, v_external_url, now(), (select auth.uid())
    )
    returning id into v_id;
  end if;

  -- Sin el código ni el enlace: solo qué vacante y en qué portal.
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'publicacion_portal_manual', 'portal_publications', v_id::text,
    jsonb_build_object('vacancy_id', p_vacancy_id, 'portal', v_portal.name));
  return v_id;
end
$$;

create function public.mark_portal_withdrawn_manually(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.portal_publications%rowtype;
begin
  if not private.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_pub from public.portal_publications where id = p_publication_id for update;
  if not found then
    raise exception 'La publicación no existe' using errcode = 'RH404';
  end if;
  if not v_pub.manual or v_pub.status <> 'publicada' then
    raise exception 'Solo se retiran a mano las publicaciones manuales que siguen publicadas' using errcode = 'RH409';
  end if;

  update public.portal_publications set status = 'retirada', updated_at = now() where id = v_pub.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'publicacion_portal_retiro_manual', 'portal_publications', v_pub.id::text,
    jsonb_build_object('vacancy_id', v_pub.vacancy_id));
end
$$;

revoke all on function public.mark_portal_published_manually(uuid, uuid, text, text) from public, anon;
grant execute on function public.mark_portal_published_manually(uuid, uuid, text, text) to authenticated;
revoke all on function public.mark_portal_withdrawn_manually(uuid) from public, anon;
grant execute on function public.mark_portal_withdrawn_manually(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Cerrar o archivar la vacante: las manuales pasan directo a 'retirada'
-- -----------------------------------------------------------------------------
create or replace function private.retire_portal_publications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cerrada', 'archivada') and old.status is distinct from new.status then
    update public.portal_publications
    set status = case when status = 'pendiente' or (manual and status = 'publicada')
                      then 'retirada'::public.portal_publication_status
                      else 'retirar'::public.portal_publication_status end,
        claimed_at = null, attempts = 0, updated_at = now()
    where vacancy_id = new.id and status in ('pendiente', 'publicando', 'publicada');
  end if;
  return null;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Bot: el listado de activas informa si la publicación es manual
-- (bot_claim_publication no necesita cambio: una manual nunca está en
-- 'pendiente', 'publicando' ni 'retirar'.)
-- -----------------------------------------------------------------------------
drop function public.bot_list_active_publications(uuid);

create function public.bot_list_active_publications(p_portal_id uuid)
returns table (publication_id uuid, external_id text, external_url text, last_synced_at timestamptz, manual boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.external_id, p.external_url, p.last_synced_at, p.manual
  from public.portal_publications p
  where p.portal_id = p_portal_id and p.status in ('publicada', 'retirar')
  order by p.last_synced_at nulls first
$$;

revoke all on function public.bot_list_active_publications(uuid) from public, anon, authenticated;
grant execute on function public.bot_list_active_publications(uuid) to service_role;
