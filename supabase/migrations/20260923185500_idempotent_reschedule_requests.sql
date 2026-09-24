-- Make public reschedule requests idempotent while one is already pending.
-- Additive replacement of the RPC only; prepared on the WhatsApp branch.
-- Do not apply to production without explicit release approval.

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

  -- While a request is still pending, repeated clicks are idempotent:
  -- preserve the original timestamp/note and do not create a new cycle.
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
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    -- Another concurrent request may have won the race after the SELECT.
    -- Re-read only the pending flag while the row is still locked/valid.
    if exists (
      select 1
      from public.appointments as a
      where a.id = v_id
        and a.reschedule_requested_at is not null
        and a.public_token_revoked_at is null
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

comment on function public.request_public_appointment_reschedule(uuid, text) is
  'Registers one pending reschedule request per appointment cycle. Repeated clicks while reschedule_requested_at is already set return already_requested without changing the original timestamp/note. After the professional changes the schedule and TurnIA clears the pending request, a new request can create a new cycle. Executable only by service_role.';

revoke all on function public.request_public_appointment_reschedule(uuid, text) from public;
revoke all on function public.request_public_appointment_reschedule(uuid, text) from anon, authenticated;
grant execute on function public.request_public_appointment_reschedule(uuid, text) to service_role;
