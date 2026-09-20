-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Conciliación de pagos de Mercado Pago: registra el pago interno (payments +
-- cash_movements) de forma atómica e idempotente cuando el webhook de
-- Mercado Pago (app/api/mercadopago/webhook/route.ts), a través del helper
-- server-only lib/mercadopago/reconcile.ts, confirma contra la Orders API
-- REAL de Mercado Pago que una orden fue efectivamente pagada.
--
-- Requiere autorización explícita de Dario antes de aplicarse contra
-- turnia-staging (Supabase CLI / dashboard, fuera de este entorno).
--
-- Por qué una función NUEVA y no reusar register_payment_with_cash:
--   register_payment_with_cash (ya existente) resuelve tenant/autorización
--   vía is_tenant_member(...)/auth.uid() — pensado para un profesional
--   autenticado registrando un cobro manual desde /payments. El webhook de
--   Mercado Pago corre server-side, sin sesión de usuario (auth.uid() es
--   NULL ahí) — no puede pasar por ese camino. record_mercadopago_payment
--   (esta migración) resuelve tenant/professional/patient SIEMPRE desde la
--   fila local de mercadopago_orders (nunca de un parámetro del caller ni
--   del payload del webhook), y su superficie de ejecución se restringe a
--   service_role — no es utilizable desde el cliente ni desde ninguna
--   Server Action con sesión de usuario normal.
--
-- Contrato de seguridad de record_mercadopago_payment:
--   - SECURITY DEFINER + SET search_path = '' (nombres siempre calificados
--     con public./auth., mismo criterio que las RPC de
--     20260918120000_clinical_audit_log.sql) — nunca resoluble por un
--     search_path manipulado.
--   - REVOKE ALL ... FROM PUBLIC, anon, authenticated + GRANT EXECUTE sólo a
--     service_role: SÓLO el webhook (vía el cliente service-role de
--     lib/supabase/service.ts) puede invocarla. Ningún usuario autenticado
--     normal, por más que conozca el nombre de la función, puede ejecutarla.
--   - Bloquea la fila de mercadopago_orders con SELECT ... FOR UPDATE ANTES
--     de cualquier verificación o escritura: serializa reintentos
--     concurrentes del webhook (o dos notificaciones casi simultáneas) para
--     la MISMA orden — el segundo intento espera a que el primero
--     confirme (o revierta) antes de decidir si ya hay un pago registrado.
--   - Re-verifica external_reference y amount contra la fila local DENTRO de
--     la transacción — nunca confía únicamente en lo que ya validó
--     reconcile.ts antes de llamarla (defensa en profundidad: esta función
--     es la única con permiso para escribir payments/cash_movements por
--     esta vía, así que no debe confiar ciegamente en su caller).
--   - Idempotente por diseño en 2 capas: (1) si
--     mercadopago_orders.payment_id YA está seteado, devuelve ese payment
--     sin insertar nada de nuevo (camino normal de un webhook reintentado);
--     (2) además, payments.idempotency_key = 'mercadopago:<mp_order_id>' es
--     estable y única (UNIQUE (tenant_id, idempotency_key), constraint ya
--     existente en payments) — red de seguridad adicional para el caso
--     extremo de una fila inconsistente (payment ya insertado pero
--     mercadopago_orders.payment_id todavía no actualizado por algún fallo
--     parcial anterior).
--   - Nunca marca como pagado por sí sola: siempre asume que quien la llama
--     (reconcile.ts) YA verificó contra la Orders API real que
--     status = 'processed' Y status_detail = 'accredited' — esta función no
--     vuelve a consultar Mercado Pago, sólo persiste esa conclusión de forma
--     atómica. status siempre se fija a 'processed' acá adentro (nunca es
--     un parámetro) — record_mercadopago_payment no puede usarse para
--     escribir ningún otro status.
--   - NUNCA toca appointments.status: el estado financiero del turno se
--     sigue derivando de payments asociados (igual que ya hacen
--     /payments, /metrics y la ficha del paciente) — no se mezcla con el
--     estado operativo (scheduled/confirmed/cancelled).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_mercadopago_payment(
  p_mp_order_id text,
  p_external_reference text,
  p_remote_total_amount numeric,
  p_remote_status_detail text
)
RETURNS TABLE (
  ok boolean,
  payment_id uuid,
  already_recorded boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.mercadopago_orders%ROWTYPE;
  v_payment_id uuid;
  v_idempotency_key text;
  v_cash_movement_exists boolean;
BEGIN
  -- Lock de la fila local ANTES de cualquier verificación o escritura:
  -- serializa esta función contra reintentos concurrentes del webhook (o dos
  -- notificaciones casi simultáneas) para la MISMA orden.
  SELECT * INTO v_order
  FROM public.mercadopago_orders
  WHERE mp_order_id = p_mp_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, false, 'order_not_found'::text;
    RETURN;
  END IF;

  -- Re-verificación DENTRO de la transacción — nunca se confía únicamente en
  -- lo que reconcile.ts ya validó contra la Orders API antes de llamar acá.
  IF v_order.external_reference IS DISTINCT FROM p_external_reference THEN
    RETURN QUERY SELECT false, NULL::uuid, false, 'reference_mismatch'::text;
    RETURN;
  END IF;

  IF round(v_order.amount, 2) IS DISTINCT FROM round(p_remote_total_amount, 2) THEN
    RETURN QUERY SELECT false, NULL::uuid, false, 'amount_mismatch'::text;
    RETURN;
  END IF;

  -- Idempotencia, capa 1: esta orden YA tiene un pago registrado — nunca se
  -- crea otro payment ni otro cash_movement, se devuelve el existente tal
  -- cual. Cubre el caso normal de un webhook reintentado por Mercado Pago
  -- (o dos notificaciones para la misma orden) después de una conciliación
  -- exitosa anterior.
  IF v_order.payment_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_order.payment_id, true, NULL::text;
    RETURN;
  END IF;

  v_idempotency_key := 'mercadopago:' || p_mp_order_id;

  -- Idempotencia, capa 2 (defensa en profundidad, no el camino normal): si
  -- por algún fallo parcial anterior ya existiera un payment con esta
  -- idempotency_key para este tenant pero mercadopago_orders.payment_id
  -- todavía no se hubiera actualizado, ON CONFLICT DO NOTHING evita
  -- duplicar el payment — se recupera su id más abajo en vez de fallar.
  INSERT INTO public.payments (
    tenant_id, appointment_id, patient_id, amount, currency, method, idempotency_key, created_at
  ) VALUES (
    v_order.tenant_id, v_order.appointment_id, v_order.patient_id, v_order.amount, v_order.currency,
    'mercadopago', v_idempotency_key, now()
  )
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    SELECT id INTO v_payment_id
    FROM public.payments
    WHERE tenant_id = v_order.tenant_id AND idempotency_key = v_idempotency_key;

    SELECT EXISTS (
      SELECT 1 FROM public.cash_movements WHERE payment_id = v_payment_id
    ) INTO v_cash_movement_exists;
  ELSE
    v_cash_movement_exists := false;
  END IF;

  -- Nunca duplicar el cash_movement de este payment (mismo criterio de
  -- idempotencia que arriba, aplicado a la segunda tabla).
  IF NOT v_cash_movement_exists THEN
    INSERT INTO public.cash_movements (
      tenant_id, payment_id, amount, method, kind, created_at
    ) VALUES (
      v_order.tenant_id, v_payment_id, v_order.amount, 'mercadopago', 'in', now()
    );
  END IF;

  UPDATE public.mercadopago_orders
  SET status = 'processed',
      status_detail = p_remote_status_detail,
      payment_id = v_payment_id,
      payment_recorded_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  RETURN QUERY SELECT true, v_payment_id, false, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.record_mercadopago_payment(text, text, numeric, text) IS
  'Conciliación atómica e idempotente de un pago de Mercado Pago: registra payments + cash_movements exactamente una vez y actualiza mercadopago_orders (status=processed, payment_id, payment_recorded_at). tenant_id/appointment_id/patient_id/amount/currency SIEMPRE salen de la fila local de mercadopago_orders (localizada por mp_order_id), nunca de un parámetro. Llamador único esperado: lib/mercadopago/reconcile.ts, DESPUÉS de verificar la orden real contra la Orders API de Mercado Pago — esta función no vuelve a consultar Mercado Pago, sólo persiste esa conclusión. Ejecutable únicamente por service_role.';

-- SÓLO service_role puede ejecutar esta función — ni siquiera un usuario
-- `authenticated` normal (a diferencia de las RPC de auditoría clínica, que
-- sí son para authenticated). No hay sesión de usuario en el webhook.
REVOKE ALL ON FUNCTION public.record_mercadopago_payment(text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mercadopago_payment(text, text, numeric, text) TO service_role;
