-- Keep final patient actions consistent with pending reprogram requests.
-- Confirming or cancelling means the patient no longer has a pending
-- reprogram request for that appointment cycle.
-- Prepared on the WhatsApp branch; do not apply to production without release approval.

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
    -- Keep historical cancellation idempotent and clean any stale pending
    -- reprogram metadata if an older flow left it behind.
    update public.appointments as a
    set reschedule_requested_at = null,
        reschedule_note = null,
        updated_at = clock_timestamp()
    where a.id = v_id
      and (a.reschedule_requested_at is not null or a.reschedule_note is not null);

    return query select 'ok'::text;
    return;
  end if;

  update public.appointments as a
  set status = 'cancelled',
      reschedule_requested_at = null,
      reschedule_note = null,
      updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
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
