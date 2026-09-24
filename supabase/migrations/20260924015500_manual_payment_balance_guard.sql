-- TurnIA — protección de saldo para pagos manuales.
-- Cierra BUG-PAY-001 / BUG-PAY-002 de la auditoría.
--
-- Objetivos:
-- - impedir que el total de pagos de un turno supere quoted_amount;
-- - serializar pagos concurrentes del mismo turno con FOR UPDATE;
-- - preservar idempotencia por (tenant_id, idempotency_key);
-- - bloquear INSERT/UPDATE/DELETE directo de authenticated sobre payments;
-- - mantener Mercado Pago intacto (su RPC usa service_role).
--
-- Compatibilidad:
-- - mismo nombre, firma y retorno de register_payment_with_cash;
-- - si quoted_amount fuera NULL, se conserva el comportamiento histórico
--   (se permite registrar el pago porque no existe un tope definido).

create or replace function public.register_payment_with_cash(
  p_appointment_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text
)
returns table(payment_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_patient_id uuid;
  v_currency text;
  v_quoted_amount numeric;
  v_paid_amount numeric := 0;
  v_payment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  if p_method is null or length(btrim(p_method)) < 1 or length(btrim(p_method)) > 60 then
    raise exception 'invalid_payment_method';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(btrim(p_idempotency_key)) > 120 then
    raise exception 'invalid_idempotency_key';
  end if;

  -- El lock sobre appointments serializa todos los pagos manuales de este turno.
  select a.tenant_id, a.patient_id, coalesce(a.currency, 'ARS'), a.quoted_amount
    into v_tenant_id, v_patient_id, v_currency, v_quoted_amount
  from public.appointments a
  where a.id = p_appointment_id
    and exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = a.tenant_id
        and tm.user_id = auth.uid()
    )
  for update of a;

  if v_tenant_id is null then
    raise exception 'appointment_not_found_or_forbidden';
  end if;

  -- Idempotencia primero: un retry legítimo debe seguir devolviendo el pago
  -- existente aunque el turno ya haya quedado totalmente saldado.
  select p.id
    into v_payment_id
  from public.payments p
  where p.tenant_id = v_tenant_id
    and p.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  if v_payment_id is not null then
    return query select v_payment_id, false;
    return;
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid_amount
  from public.payments p
  where p.tenant_id = v_tenant_id
    and p.appointment_id = p_appointment_id;

  if v_quoted_amount is not null and (v_paid_amount + p_amount) > v_quoted_amount then
    raise exception 'payment_exceeds_remaining_balance';
  end if;

  insert into public.payments (
    tenant_id, appointment_id, patient_id, amount, currency, method, idempotency_key
  ) values (
    v_tenant_id, p_appointment_id, v_patient_id, p_amount, v_currency, btrim(p_method), btrim(p_idempotency_key)
  )
  returning id into v_payment_id;

  insert into public.cash_movements (
    tenant_id, payment_id, amount, method, kind
  ) values (
    v_tenant_id, v_payment_id, p_amount, btrim(p_method), 'in'
  );

  return query select v_payment_id, true;
end;
$$;

revoke all on function public.register_payment_with_cash(uuid, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.register_payment_with_cash(uuid, numeric, text, text)
  to authenticated;

-- payments queda de sólo lectura para sesiones autenticadas. Las escrituras
-- válidas quedan concentradas en RPC controladas (manual + Mercado Pago server-only).
drop policy if exists payments_member_all on public.payments;
drop policy if exists payments_member_select on public.payments;

create policy payments_member_select
  on public.payments
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

revoke insert, update, delete on table public.payments from authenticated;
grant select on table public.payments to authenticated;
