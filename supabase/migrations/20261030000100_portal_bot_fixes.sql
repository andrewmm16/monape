-- Correcciones de la cola del robot de portales (revisión del 2026-10-30).
-- 1. Cerrar una vacante mientras el robot la publica fallaba (23514): «retirar»
--    ahora puede no tener id externo todavía.
-- 2. Si el robot publica y su resultado llega cuando la vacante ya se cerró, se
--    guarda el id y la oferta se retira en el ciclo siguiente.
-- 3. Un retiro que agota sus 3 intentos pasa a «error» CONSERVANDO el id externo
--    (la oferta sigue viva), RRHH puede volver a pedirlo, y ya no bloquea la
--    cola ni retrasa los trabajos que siguen.
-- 4. bot_mark_synced avisa (RH404) si la publicación no existe.

-- -----------------------------------------------------------------------------
-- 1. Solo «publicada» exige id externo
-- -----------------------------------------------------------------------------
alter table public.portal_publications drop constraint portal_publications_published_check;
alter table public.portal_publications
  add constraint portal_publications_published_check check (status <> 'publicada' or external_id is not null);

-- -----------------------------------------------------------------------------
-- 2. RRHH: no se vuelve a publicar una oferta que sigue viva; sí se reintenta un retiro
-- -----------------------------------------------------------------------------
create or replace function public.request_portal_publication(p_vacancy_id uuid, p_portal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.vacancies%rowtype;
  v_portal public.job_portals%rowtype;
  v_existing public.portal_publications%rowtype;
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
    raise exception 'Solo se publican vacantes en estado publicada' using errcode = 'RH409';
  end if;

  select * into v_portal from public.job_portals where id = p_portal_id and is_active and bot_enabled;
  if not found then
    raise exception 'El portal no existe o no admite publicación automática' using errcode = 'RH404';
  end if;

  select * into v_existing
  from public.portal_publications
  where vacancy_id = p_vacancy_id and portal_id = p_portal_id
  for update;

  if found then
    if v_existing.status not in ('error', 'retirada') then
      raise exception 'La vacante ya está solicitada en este portal' using errcode = 'RH409';
    end if;
    -- Un retiro fallido deja la oferta viva: publicar de nuevo la duplicaría.
    if v_existing.status = 'error' and v_existing.external_id is not null then
      raise exception 'La oferta sigue publicada en el portal: retírela antes de volver a publicar' using errcode = 'RH409';
    end if;
    -- Una oferta retirada en el portal puede volver a publicarse; la anterior queda olvidada.
    update public.portal_publications
    set status = 'pendiente', external_id = null, external_url = null, error_code = null,
        attempts = 0, claimed_at = null, published_at = null,
        requested_by = (select auth.uid()), requested_at = now(), updated_at = now()
    where id = v_existing.id;
    v_id := v_existing.id;
  else
    insert into public.portal_publications (vacancy_id, portal_id, requested_by)
    values (p_vacancy_id, p_portal_id, (select auth.uid()))
    returning id into v_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'publicacion_portal_solicitada', 'portal_publications', v_id::text,
    jsonb_build_object('vacancy_id', p_vacancy_id, 'portal', v_portal.name));
  return v_id;
end
$$;

create or replace function public.request_portal_withdrawal(p_publication_id uuid)
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

  if v_pub.status = 'publicada' or (v_pub.status = 'error' and v_pub.external_id is not null) then
    -- «error» con id externo = un retiro que falló: la oferta sigue viva y se vuelve a intentar.
    update public.portal_publications
    set status = 'retirar', claimed_at = null, attempts = 0, error_code = null, updated_at = now()
    where id = v_pub.id;
  elsif v_pub.status = 'pendiente' then
    -- Aún no salió: se cancela sin tocar el portal.
    update public.portal_publications set status = 'retirada', updated_at = now() where id = v_pub.id;
  else
    raise exception 'La publicación no se puede retirar en este estado' using errcode = 'RH409';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'publicacion_portal_retiro', 'portal_publications', v_pub.id::text,
    jsonb_build_object('vacancy_id', v_pub.vacancy_id));
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Bot: reclamar (sin bloquear la cola con lo que agotó sus intentos) y reportar
-- -----------------------------------------------------------------------------
create or replace function public.bot_claim_publication(p_portal_id uuid)
returns table (publication_id uuid, action text, external_id text, vacancy jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.portal_publications%rowtype;
  v_vacancy public.vacancies%rowtype;
begin
  loop
    select p.* into v_pub
    from public.portal_publications p
    where p.portal_id = p_portal_id
      and p.status in ('pendiente', 'publicando', 'retirar')
      and (p.claimed_at is null or p.claimed_at < now() - interval '30 minutes')
    order by p.requested_at
    limit 1
    for update skip locked;
    if not found then
      return;
    end if;

    exit when v_pub.attempts < 3;

    -- Agotó sus intentos: sale de la cola y pasa a «error» (un retiro conserva su id externo
    -- porque la oferta sigue viva) y se busca el siguiente trabajo.
    update public.portal_publications
    set status = 'error',
        error_code = case when v_pub.status = 'retirar' then 'retiro_fallido' else 'demasiados_intentos' end,
        claimed_at = null, updated_at = now()
    where id = v_pub.id;
  end loop;

  update public.portal_publications
  set claimed_at = now(), attempts = attempts + 1,
      status = case when status = 'retirar' then status else 'publicando'::public.portal_publication_status end,
      updated_at = now()
  where id = v_pub.id;

  select * into v_vacancy from public.vacancies where id = v_pub.vacancy_id;

  return query select
    v_pub.id,
    case when v_pub.status = 'retirar' then 'retirar' else 'publicar' end,
    v_pub.external_id,
    jsonb_build_object(
      'id', v_vacancy.id,
      'title', v_vacancy.title,
      'department', v_vacancy.department,
      'description', v_vacancy.description,
      'responsibilities', v_vacancy.responsibilities,
      'location', v_vacancy.location,
      'city', v_vacancy.city,
      'region', v_vacancy.region,
      'modality', v_vacancy.modality,
      'contract_type', v_vacancy.contract_type,
      'closing_date', v_vacancy.closing_date,
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object('description', r.description, 'priority', r.priority)
                         order by r.position, r.created_at)
        from public.vacancy_requirements r where r.vacancy_id = v_vacancy.id
      ), '[]'::jsonb)
    );
end
$$;

create or replace function public.bot_report_publication(
  p_publication_id uuid,
  p_outcome text,
  p_external_id text,
  p_external_url text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.portal_publications%rowtype;
begin
  select * into v_pub from public.portal_publications where id = p_publication_id for update;
  if not found then
    raise exception 'La publicación no existe' using errcode = 'RH404';
  end if;

  if p_outcome = 'publicada' then
    if v_pub.status = 'publicando' then
      update public.portal_publications
      set status = 'publicada', external_id = p_external_id, external_url = p_external_url,
          error_code = null, claimed_at = null, published_at = now(), updated_at = now()
      where id = v_pub.id;
    elsif v_pub.status = 'retirar' and v_pub.external_id is null then
      -- La vacante se cerró mientras se publicaba: se guarda el id y el siguiente ciclo la retira.
      update public.portal_publications
      set external_id = p_external_id, external_url = p_external_url,
          error_code = null, claimed_at = null, attempts = 0, published_at = now(), updated_at = now()
      where id = v_pub.id;
    else
      raise exception 'La publicación no está en curso' using errcode = 'RH409';
    end if;
  elsif p_outcome = 'retirada' then
    if v_pub.status <> 'retirar' then
      raise exception 'La publicación no está en retiro' using errcode = 'RH409';
    end if;
    update public.portal_publications
    set status = 'retirada', error_code = null, claimed_at = null, updated_at = now()
    where id = v_pub.id;
  elsif p_outcome = 'error' then
    if v_pub.status not in ('publicando', 'retirar') then
      raise exception 'La publicación no está en curso' using errcode = 'RH409';
    end if;
    -- Un fallo al publicar queda visible para RRHH; uno al retirar se reintenta.
    update public.portal_publications
    set status = case when status = 'publicando' then 'error'::public.portal_publication_status else status end,
        error_code = p_error_code, claimed_at = null, updated_at = now()
    where id = v_pub.id;
  else
    raise exception 'Resultado no válido' using errcode = 'RH422';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'publicacion_portal_' || p_outcome, 'portal_publications', v_pub.id::text,
    jsonb_build_object('vacancy_id', v_pub.vacancy_id, 'portal_id', v_pub.portal_id, 'error_code', p_error_code));
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Marcar como sincronizada solo una publicación que existe
-- -----------------------------------------------------------------------------
create or replace function public.bot_mark_synced(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.portal_publications set last_synced_at = now() where id = p_publication_id;
  if not found then
    raise exception 'La publicación no existe' using errcode = 'RH404';
  end if;
end
$$;
