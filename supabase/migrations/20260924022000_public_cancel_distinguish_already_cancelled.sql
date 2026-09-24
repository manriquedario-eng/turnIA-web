-- TurnIA — cancelación pública idempotente con resultado distinguible.
-- Mantiene el mismo contrato RETURNS TABLE(result text), pero devuelve
-- already_cancelled cuando la fila ya estaba cancelada. Esto permite que
-- Google/email se ejecuten una sola vez tras una cancelación nueva.

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

  if v_status in ('cancelled', 'cancelado') then
    return query select 'already_cancelled'::text;
    return;
  end if;

  update public.appointments as a
  set status = 'cancelled', updated_at = clock_timestamp()
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

revoke all on function public.cancel_public_appointment(uuid) from public, anon, authenticated;
grant execute on function public.cancel_public_appointment(uuid) to service_role;

comment on function public.cancel_public_appointment(uuid) is
  'Cancela un turno vía public_token. Devuelve ok sólo cuando ejecutó una nueva cancelación, already_cancelled si ya estaba cancelado y not_available si el link no está disponible. Ejecutable únicamente por service_role.';
