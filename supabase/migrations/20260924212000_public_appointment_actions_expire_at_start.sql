-- Public appointment action expiry hardening.
-- The public appointment page may remain readable during its grace window,
-- but confirm/cancel/reschedule mutations are allowed only before starts_at.

create or replace function public.confirm_public_appointment(p_token uuid)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_updated_id uuid;
begin
  select a.id, a.status
    into v_id, v_status
  from public.appointments as a
  where a.public_token = p_token
    and a.public_token_revoked_at is null
    and a.starts_at > clock_timestamp()
    and a.ends_at + interval '24 hours' > clock_timestamp()
  for update;

  if not found then
    return query select 'not_available'::text;
    return;
  end if;

  if v_status in ('cancelled', 'cancelado') then
    return query select 'already_cancelled'::text;
    return;
  end if;

  if v_status in ('completed', 'completado') then
    return query select 'not_available'::text;
    return;
  end if;

  update public.appointments as a
  set status = 'confirmed',
      reschedule_requested_at = null,
      reschedule_note = null,
      updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
    and a.starts_at > clock_timestamp()
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    return query select 'not_available'::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.confirm_public_appointment(uuid) from public;
revoke all on function public.confirm_public_appointment(uuid) from anon, authenticated;
grant execute on function public.confirm_public_appointment(uuid) to service_role;

create or replace function public.cancel_public_appointment(p_token uuid)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_updated_id uuid;
begin
  select a.id, a.status
    into v_id, v_status
  from public.appointments as a
  where a.public_token = p_token
    and a.public_token_revoked_at is null
    and a.starts_at > clock_timestamp()
    and a.ends_at + interval '24 hours' > clock_timestamp()
  for update;

  if not found then
    return query select 'not_available'::text;
    return;
  end if;

  if v_status in ('completed', 'completado') then
    return query select 'not_available'::text;
    return;
  end if;

  if v_status in ('cancelled', 'cancelado') then
    update public.appointments as a
    set reschedule_requested_at = null,
        reschedule_note = null,
        updated_at = clock_timestamp()
    where a.id = v_id
      and (a.reschedule_requested_at is not null or a.reschedule_note is not null);

    return query select 'already_cancelled'::text;
    return;
  end if;

  update public.appointments as a
  set status = 'cancelled',
      reschedule_requested_at = null,
      reschedule_note = null,
      updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
    and a.starts_at > clock_timestamp()
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    return query select 'not_available'::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.cancel_public_appointment(uuid) from public;
revoke all on function public.cancel_public_appointment(uuid) from anon, authenticated;
grant execute on function public.cancel_public_appointment(uuid) to service_role;

create or replace function public.request_public_appointment_reschedule(
  p_token uuid,
  p_note text
)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_reschedule_requested_at timestamptz;
  v_note text;
  v_updated_id uuid;
begin
  select a.id, a.status, a.reschedule_requested_at
    into v_id, v_status, v_reschedule_requested_at
  from public.appointments as a
  where a.public_token = p_token
    and a.public_token_revoked_at is null
    and a.starts_at > clock_timestamp()
    and a.ends_at + interval '24 hours' > clock_timestamp()
  for update;

  if not found then
    return query select 'not_available'::text;
    return;
  end if;

  if v_status in ('cancelled', 'cancelado') then
    return query select 'already_cancelled'::text;
    return;
  end if;

  if v_status in ('completed', 'completado') then
    return query select 'not_available'::text;
    return;
  end if;

  if v_reschedule_requested_at is not null then
    return query select 'already_requested'::text;
    return;
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 500 then
    v_note := left(v_note, 500);
  end if;

  update public.appointments as a
  set reschedule_requested_at = clock_timestamp(),
      reschedule_note = v_note,
      updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
    and a.reschedule_requested_at is null
    and a.starts_at > clock_timestamp()
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    if exists (
      select 1
      from public.appointments as a
      where a.id = v_id
        and a.reschedule_requested_at is not null
        and a.public_token_revoked_at is null
        and a.starts_at > clock_timestamp()
        and a.ends_at + interval '24 hours' > clock_timestamp()
    ) then
      return query select 'already_requested'::text;
      return;
    end if;

    return query select 'not_available'::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.request_public_appointment_reschedule(uuid, text) from public;
revoke all on function public.request_public_appointment_reschedule(uuid, text) from anon, authenticated;
grant execute on function public.request_public_appointment_reschedule(uuid, text) to service_role;
