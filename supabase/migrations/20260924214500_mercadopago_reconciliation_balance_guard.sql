-- Mercado Pago reconciliation balance guard.
-- Prevents recording a provider payment that would exceed the remaining
-- appointment balance because another payment was registered after checkout creation.

create or replace function public.record_mercadopago_payment(
  p_mp_order_id text,
  p_external_reference text,
  p_remote_total_amount numeric,
  p_remote_status_detail text
)
returns table(ok boolean, payment_id uuid, already_recorded boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mercadopago_orders%rowtype;
  v_payment_id uuid;
  v_idempotency_key text;
  v_cash_movement_exists boolean;
  v_total_due numeric;
  v_paid_amount numeric := 0;
begin
  select * into v_order
  from public.mercadopago_orders
  where mp_order_id = p_mp_order_id
  for update;

  if not found then
    return query select false, null::uuid, false, 'order_not_found'::text;
    return;
  end if;

  if v_order.external_reference is distinct from p_external_reference then
    return query select false, null::uuid, false, 'reference_mismatch'::text;
    return;
  end if;

  if round(v_order.amount, 2) is distinct from round(p_remote_total_amount, 2) then
    return query select false, null::uuid, false, 'amount_mismatch'::text;
    return;
  end if;

  if v_order.payment_id is not null then
    return query select true, v_order.payment_id, true, null::text;
    return;
  end if;

  v_idempotency_key := 'mercadopago:' || p_mp_order_id;

  select p.id into v_payment_id
  from public.payments p
  where p.tenant_id = v_order.tenant_id
    and p.idempotency_key = v_idempotency_key
  limit 1;

  if v_payment_id is not null then
    select exists (
      select 1 from public.cash_movements where payment_id = v_payment_id
    ) into v_cash_movement_exists;

    if not v_cash_movement_exists then
      insert into public.cash_movements (
        tenant_id, payment_id, amount, method, kind, created_at
      ) values (
        v_order.tenant_id, v_payment_id, v_order.amount, 'mercadopago', 'in', now()
      );
    end if;

    update public.mercadopago_orders
    set status = 'processed',
        status_detail = p_remote_status_detail,
        payment_id = v_payment_id,
        payment_recorded_at = coalesce(payment_recorded_at, now()),
        updated_at = now()
    where id = v_order.id;

    return query select true, v_payment_id, true, null::text;
    return;
  end if;

  select
    case
      when a.quoted_amount is not null and a.quoted_amount > 0 then a.quoted_amount
      when s.price is not null and s.price > 0 then s.price
      else null
    end
  into v_total_due
  from public.appointments a
  left join public.services s
    on s.id = a.service_id
   and s.tenant_id = a.tenant_id
  where a.id = v_order.appointment_id
    and a.tenant_id = v_order.tenant_id
  for update of a;

  if v_total_due is null then
    return query select false, null::uuid, false, 'appointment_amount_unavailable'::text;
    return;
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid_amount
  from public.payments p
  where p.tenant_id = v_order.tenant_id
    and p.appointment_id = v_order.appointment_id;

  if round(v_paid_amount + v_order.amount, 2) > round(v_total_due, 2) then
    return query select false, null::uuid, false, 'payment_exceeds_remaining_balance'::text;
    return;
  end if;

  insert into public.payments (
    tenant_id, appointment_id, patient_id, amount, currency, method, idempotency_key, created_at
  ) values (
    v_order.tenant_id, v_order.appointment_id, v_order.patient_id, v_order.amount, v_order.currency,
    'mercadopago', v_idempotency_key, now()
  )
  returning id into v_payment_id;

  insert into public.cash_movements (
    tenant_id, payment_id, amount, method, kind, created_at
  ) values (
    v_order.tenant_id, v_payment_id, v_order.amount, 'mercadopago', 'in', now()
  );

  update public.mercadopago_orders
  set status = 'processed',
      status_detail = p_remote_status_detail,
      payment_id = v_payment_id,
      payment_recorded_at = now(),
      updated_at = now()
  where id = v_order.id;

  return query select true, v_payment_id, false, null::text;
end;
$$;

revoke all on function public.record_mercadopago_payment(text,text,numeric,text) from public;
revoke all on function public.record_mercadopago_payment(text,text,numeric,text) from anon, authenticated;
grant execute on function public.record_mercadopago_payment(text,text,numeric,text) to service_role;
