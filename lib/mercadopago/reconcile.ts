// Conciliación server-only de una orden de Mercado Pago: dado un
// mp_order_id (el `data.id` que trae el webhook), confirma contra la Orders
// API REAL de Mercado Pago qué pasó con esa orden y, sólo si corresponde,
// registra el pago interno de forma atómica e idempotente.
//
// Único caller esperado: app/api/mercadopago/webhook/route.ts. La ruta del
// webhook SÓLO valida la firma `x-signature`, extrae `data.id` y llama a
// `reconcileMercadoPagoOrder(dataId)` — toda la lógica de negocio vive acá.
//
// Principio rector (pedido original, PARTE 1/2): el payload del webhook NO
// es la fuente autoritativa de nada. El webhook es sólo el DISPARADOR — la
// única fuente autoritativa del monto y del estado real de una orden es la
// respuesta de `GET /v1/orders/{id}` de la Orders API, consultada acá con el
// access_token del profesional dueño de esa orden (nunca con datos del
// payload del webhook, nunca con datos recibidos del browser).
//
// Endpoint oficial confirmado (Mercado Pago Developers, "Get order by ID",
// Orders API — no inventado):
//   GET https://api.mercadopago.com/v1/orders/{id}
//
// Campos usados del response, confirmados cruzando la referencia REST
// oficial (mercadopago.com.ar/developers/en/reference/orders/online-payments/get-order/get)
// contra los tags JSON del SDK oficial de Go (pkg.go.dev/github.com/mercadopago/sdk-go/pkg/order,
// mismo criterio ya usado en lib/mercadopago/orders.ts) — ambas fuentes
// coinciden, sin discrepancias, en:
//   id, status, status_detail, total_amount (string, 2 decimales),
//   external_reference, transactions.payments[] / .refunds[] / .chargebacks[]
// Por eso el parser de abajo sólo mira esos campos (allowlist), nunca el
// objeto completo.
//
// Semántica de status/status_detail (Mercado Pago Developers, "Order
// status" y "Transaction status"): la ÚNICA combinación que representa un
// pago efectivamente acreditado es status = 'processed' CON
// status_detail = 'accredited'. `processed` con status_detail
// `partially_refunded`, o cualquier otro status (created/processing/
// action_required/failed/canceled/refunded/charged_back/expired), NUNCA
// dispara el registro de un pago nuevo acá — ver PARTE 2/4 del pedido.
//
// Nunca se loguea: el access_token, el body completo de la respuesta de
// Mercado Pago, ni datos del paciente (email/nombre). Sólo identificadores
// técnicos no sensibles (ids internos, status, motivos de fallo).

import 'server-only';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { decryptMercadoPagoToken, isMercadoPagoTokenEncryptionConfigured } from './token-crypto';

const MP_ORDER_GET_ENDPOINT = (mpOrderId: string) => `https://api.mercadopago.com/v1/orders/${encodeURIComponent(mpOrderId)}`;

// ---------------------------------------------------------------------------
// Helpers duplicados A PROPÓSITO desde lib/mercadopago/orders.ts (en vez de
// exportarlos desde ahí e importarlos acá). PARTE 10 del pedido pide no
// tocar orders.ts salvo necesidad demostrable, y estos helpers son puros,
// chicos (sin estado, sin llamadas a Mercado Pago ni a Supabase) y no
// afectan el flujo de creación de checkout — duplicarlos es más seguro que
// tocar ese archivo sólo para agregar unos `export`. Si algún día se decide
// unificarlos, es un refactor aparte, no parte de esta tarea.
// ---------------------------------------------------------------------------

// Allowlist EXACTA del constraint de mercadopago_orders.status (idéntica a
// MP_ORDER_STATUS_ALLOWLIST en orders.ts). Documentación oficial de Mercado
// Pago lista además `charged_back` y `expired` como valores de status de
// una Order — NO están en este allowlist porque el CHECK constraint actual
// de la tabla (ver migraciones existentes) no los contempla. Ver
// `mapRemoteStatusForLocalStorage` más abajo para cómo se mapean sin perder
// información ni romper el constraint.
const MP_ORDER_STATUS_ALLOWLIST = ['created', 'processing', 'processed', 'action_required', 'failed', 'refunded', 'canceled'] as const;
type MercadoPagoOrderStatus = (typeof MP_ORDER_STATUS_ALLOWLIST)[number];

function isAllowedOrderStatus(value: unknown): value is MercadoPagoOrderStatus {
  return typeof value === 'string' && (MP_ORDER_STATUS_ALLOWLIST as readonly string[]).includes(value);
}

function sanitizeScalarField(value: unknown, maxLength = 200): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).slice(0, maxLength);
  }
  return null;
}

function sanitizeStatusDetail(value: unknown): string | null {
  return sanitizeScalarField(value, 200);
}

/**
 * Mapea un status documentado por Mercado Pago pero fuera del CHECK actual
 * de mercadopago_orders.status (`charged_back`, `expired`) al valor
 * permitido más cercano semánticamente, para poder persistirlo sin romper
 * el constraint. La información real nunca se pierde: siempre queda en
 * status_detail (ver caller). Cualquier otro valor no reconocido devuelve
 * `null` — el caller NUNCA sobreescribe el status local con algo
 * desconocido, sólo lo deja registrado en logs para revisión manual.
 */
function mapRemoteStatusForLocalStorage(remoteStatus: string | null): MercadoPagoOrderStatus | null {
  if (isAllowedOrderStatus(remoteStatus)) return remoteStatus;
  if (remoteStatus === 'charged_back') return 'refunded';
  if (remoteStatus === 'expired') return 'canceled';
  return null;
}

// ---------------------------------------------------------------------------
// Parser defensivo de la respuesta de GET /v1/orders/{id} — SOLO los campos
// allowlisted de arriba. Nunca asume la forma completa del objeto; cualquier
// campo ausente o del tipo equivocado se trata como `null`/0, nunca lanza.
// ---------------------------------------------------------------------------

type ParsedProviderReversal = {
  id: string;
  amount: number;
  status: string | null;
};

type ParsedMercadoPagoOrder = {
  id: string;
  status: string | null;
  statusDetail: string | null;
  totalAmount: number | null;
  externalReference: string | null;
  paymentsCount: number;
  refunds: ParsedProviderReversal[];
  chargebacks: ParsedProviderReversal[];
};

function parseProviderReversals(value: unknown): ParsedProviderReversal[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const id = sanitizeScalarField(row.id, 120);
    const rawAmount = row.amount;
    const amount =
      typeof rawAmount === 'string' || typeof rawAmount === 'number'
        ? Number(rawAmount)
        : NaN;

    if (!id || !Number.isFinite(amount) || amount <= 0) return [];

    return [{
      id,
      amount,
      status: sanitizeScalarField(row.status, 80),
    }];
  });
}

function parseMercadoPagoOrderResponse(json: unknown): ParsedMercadoPagoOrder | null {
  if (typeof json !== 'object' || json === null) return null;
  const root = json as Record<string, unknown>;

  const id = sanitizeScalarField(root.id, 100);
  if (!id) return null;

  const totalAmountRaw = root.total_amount;
  const totalAmountNumber =
    typeof totalAmountRaw === 'string' || typeof totalAmountRaw === 'number' ? Number(totalAmountRaw) : NaN;

  let paymentsCount = 0;
  let refunds: ParsedProviderReversal[] = [];
  let chargebacks: ParsedProviderReversal[] = [];
  const transactionsRaw = root.transactions;
  if (typeof transactionsRaw === 'object' && transactionsRaw !== null) {
    const transactions = transactionsRaw as Record<string, unknown>;
    if (Array.isArray(transactions.payments)) paymentsCount = transactions.payments.length;
    refunds = parseProviderReversals(transactions.refunds);
    chargebacks = parseProviderReversals(transactions.chargebacks);
  }

  return {
    id,
    status: sanitizeScalarField(root.status, 60),
    statusDetail: sanitizeScalarField(root.status_detail, 100),
    totalAmount: Number.isFinite(totalAmountNumber) ? totalAmountNumber : null,
    externalReference: sanitizeScalarField(root.external_reference, 100),
    paymentsCount,
    refunds,
    chargebacks,
  };
}

// ---------------------------------------------------------------------------
// Resultado tipado y seguro — nunca incluye el access_token, el body de
// Mercado Pago, ni datos del paciente.
// ---------------------------------------------------------------------------

type ReconcileFailureReason =
  | 'not_configured'
  | 'order_not_found'
  | 'connection_not_found'
  | 'token_expired'
  | 'internal_error'
  | 'network_error'
  | 'remote_order_not_found'
  | 'remote_client_error'
  | 'remote_server_error'
  | 'invalid_remote_response'
  | 'id_mismatch'
  | 'reference_mismatch'
  | 'amount_mismatch'
  | 'unexpected_remote_status'
  | 'rpc_error'
  | 'payment_review_required';

export type ReconcileMercadoPagoOrderResult =
  | { ok: true; outcome: 'payment_recorded' | 'payment_already_recorded'; localOrderId: string; paymentId: string }
  | {
      ok: true;
      outcome: 'status_updated';
      localOrderId: string;
      status: MercadoPagoOrderStatus;
      // Cantidad de reversos nuevos (refund/chargeback) registrados en esta
      // conciliación. Reintentos del mismo webhook no incrementan este valor.
      reversalsRecorded?: number;
    }
  | { ok: false; reason: ReconcileFailureReason; transient: boolean; localOrderId?: string };

type LocalOrderRow = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  appointment_id: string | null;
  patient_id: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  external_reference: string | null;
  mp_order_id: string | null;
  payment_id: string | null;
};

type MercadoPagoConnectionRow = {
  access_token_ciphertext: string;
  token_expires_at: string | null;
  revoked_at: string | null;
};

/**
 * Concilia una orden de Mercado Pago identificada por `mpOrderId` (el
 * `data.id` del webhook). Nunca lanza: cualquier problema se devuelve como
 * `{ ok: false, reason, transient }` — `transient` le indica al caller
 * (el webhook) si tiene sentido que Mercado Pago reintente la notificación
 * (500) o no (200, no se va a resolver reintentando).
 */
export async function reconcileMercadoPagoOrder(mpOrderId: string): Promise<ReconcileMercadoPagoOrderResult> {
  if (!mpOrderId) {
    return { ok: false, reason: 'order_not_found', transient: false };
  }

  if (!isServiceRoleConfigured() || !isMercadoPagoTokenEncryptionConfigured()) {
    // No es un problema estructural de esta orden puntual — podría ser un
    // deploy a mitad de configurar. Se trata como transitorio para no
    // perder la notificación silenciosamente.
    console.error('Mercado Pago reconcile: service role o cifrado de tokens no configurado');
    return { ok: false, reason: 'not_configured', transient: true };
  }

  const serviceClient = createSupabaseServiceClient();

  // A. Fila local — SIEMPRE con el cliente service-role, mismo criterio que
  // el resto de lib/mercadopago/ (nunca con el cliente RLS normal).
  let localOrder: LocalOrderRow | null;
  try {
    const { data, error } = await serviceClient
      .from('mercadopago_orders')
      .select('id, tenant_id, professional_id, appointment_id, patient_id, amount, currency, status, external_reference, mp_order_id, payment_id')
      .eq('mp_order_id', mpOrderId)
      .maybeSingle();
    if (error) throw error;
    localOrder = data as LocalOrderRow | null;
  } catch (err) {
    console.error('Mercado Pago reconcile: fallo leyendo mercadopago_orders', err instanceof Error ? err.message : 'error desconocido');
    return { ok: false, reason: 'internal_error', transient: true };
  }

  if (!localOrder) {
    // Notificación auténtica (firma ya validada por el caller) pero sin
    // fila local todavía — puede ser una carrera real entre la creación del
    // checkout y la llegada del webhook (Mercado Pago puede notificar casi
    // instantáneamente). Se trata como transitorio: si en unos segundos ya
    // existe la fila, un reintento de Mercado Pago la va a encontrar.
    return { ok: false, reason: 'order_not_found', transient: true };
  }

  if (!localOrder.professional_id) {
    console.error('Mercado Pago reconcile: la orden local no tiene professional_id', { localOrderId: localOrder.id });
    return { ok: false, reason: 'connection_not_found', transient: false, localOrderId: localOrder.id };
  }

  // B. Conexión del profesional dueño de la orden — SIEMPRE resuelto desde
  // la fila local, nunca desde el payload del webhook.
  let connection: MercadoPagoConnectionRow | null;
  try {
    const { data, error } = await serviceClient
      .from('mercadopago_connections')
      .select('access_token_ciphertext, token_expires_at, revoked_at')
      .eq('tenant_id', localOrder.tenant_id)
      .eq('user_id', localOrder.professional_id)
      .maybeSingle();
    if (error) throw error;
    connection = data as MercadoPagoConnectionRow | null;
  } catch (err) {
    console.error('Mercado Pago reconcile: fallo leyendo mercadopago_connections', err instanceof Error ? err.message : 'error desconocido');
    return { ok: false, reason: 'internal_error', transient: true, localOrderId: localOrder.id };
  }

  if (!connection || connection.revoked_at) {
    return { ok: false, reason: 'connection_not_found', transient: false, localOrderId: localOrder.id };
  }
  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'token_expired', transient: false, localOrderId: localOrder.id };
  }

  const decrypted = decryptMercadoPagoToken(connection.access_token_ciphertext);
  if (!decrypted.ok) {
    console.error('Mercado Pago reconcile: no se pudo descifrar el access_token de la conexión');
    return { ok: false, reason: 'internal_error', transient: true, localOrderId: localOrder.id };
  }
  const accessToken = decrypted.data;

  // C. Consulta REAL a la Orders API — nunca se confía en el payload del
  // webhook para el monto ni el estado.
  let httpStatus = 0;
  let remoteJson: unknown = null;
  try {
    const response = await fetch(MP_ORDER_GET_ENDPOINT(mpOrderId), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = response.status;
    remoteJson = await response.json().catch(() => null);
  } catch (err) {
    console.error('Mercado Pago reconcile: fallo de red consultando la orden', { localOrderId: localOrder.id }, err instanceof Error ? err.message : 'error desconocido');
    return { ok: false, reason: 'network_error', transient: true, localOrderId: localOrder.id };
  }

  if (httpStatus === 404) {
    console.error('Mercado Pago reconcile: Mercado Pago no encontró la orden remota', { localOrderId: localOrder.id, httpStatus });
    return { ok: false, reason: 'remote_order_not_found', transient: true, localOrderId: localOrder.id };
  }
  if (httpStatus >= 500) {
    console.error('Mercado Pago reconcile: error del servidor de Mercado Pago', { localOrderId: localOrder.id, httpStatus });
    return { ok: false, reason: 'remote_server_error', transient: true, localOrderId: localOrder.id };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    console.error('Mercado Pago reconcile: Mercado Pago rechazó la consulta de la orden', { localOrderId: localOrder.id, httpStatus });
    return { ok: false, reason: 'remote_client_error', transient: false, localOrderId: localOrder.id };
  }

  const parsed = parseMercadoPagoOrderResponse(remoteJson);
  if (!parsed) {
    console.error('Mercado Pago reconcile: la respuesta de la orden no tiene la forma esperada', { localOrderId: localOrder.id });
    return { ok: false, reason: 'invalid_remote_response', transient: true, localOrderId: localOrder.id };
  }

  // D. Validaciones mínimas ANTES de considerar registrar nada (PARTE 2).
  if (parsed.id !== localOrder.mp_order_id) {
    console.error('Mercado Pago reconcile: el id de la orden remota no coincide con la fila local', { localOrderId: localOrder.id });
    return { ok: false, reason: 'id_mismatch', transient: false, localOrderId: localOrder.id };
  }
  if ((parsed.externalReference ?? null) !== (localOrder.external_reference ?? null)) {
    console.error('Mercado Pago reconcile: external_reference remoto no coincide con la fila local', { localOrderId: localOrder.id });
    return { ok: false, reason: 'reference_mismatch', transient: false, localOrderId: localOrder.id };
  }
  if (parsed.totalAmount === null) {
    console.error('Mercado Pago reconcile: la orden remota no trajo un total_amount utilizable', { localOrderId: localOrder.id });
    return { ok: false, reason: 'invalid_remote_response', transient: true, localOrderId: localOrder.id };
  }
  const localAmount = Number(localOrder.amount);
  // Tolerancia mínima (medio centavo) para diferencias de representación de
  // punto flotante entre "100" (local, numeric) y "100.00" (string de la
  // Orders API) — nunca para enmascarar un monto realmente distinto.
  if (!Number.isFinite(localAmount) || Math.abs(localAmount - parsed.totalAmount) > 0.005) {
    console.error('Mercado Pago reconcile: el monto remoto no coincide con el de la orden local', { localOrderId: localOrder.id });
    return { ok: false, reason: 'amount_mismatch', transient: false, localOrderId: localOrder.id };
  }

  // E. Sólo `processed` + `accredited` representa un pago efectivamente
  // acreditado (ver comentario de cabecera) — nunca se decide por `action`
  // ni por el status a secas.
  const isFullyAccredited = parsed.status === 'processed' && parsed.statusDetail === 'accredited';

  if (isFullyAccredited) {
    // Se llama a la RPC SIEMPRE que la orden esté acreditada, incluso si
    // localOrder.payment_id ya estaba seteado (webhook reintentado): la RPC
    // es idempotente por diseño (ver la migración) y el costo de un
    // SELECT ... FOR UPDATE que devuelve de inmediato es mínimo — más
    // simple y más seguro que duplicar la lógica de idempotencia acá.
    try {
      const { data, error } = await serviceClient.rpc('record_mercadopago_payment', {
        p_mp_order_id: localOrder.mp_order_id,
        p_external_reference: parsed.externalReference,
        p_remote_total_amount: parsed.totalAmount,
        p_remote_status_detail: sanitizeStatusDetail(parsed.statusDetail),
      });
      if (error) throw error;

      const row = (Array.isArray(data) ? data[0] : data) as
        | { ok: boolean; payment_id: string | null; already_recorded: boolean; reason: string | null }
        | undefined;

      if (!row?.ok || !row.payment_id) {
        const rpcReason = row?.reason ?? 'unknown';
        console.error('Mercado Pago reconcile: record_mercadopago_payment devolvió ok=false', {
          localOrderId: localOrder.id,
          reason: rpcReason,
        });

        if (
          rpcReason === 'payment_exceeds_remaining_balance' ||
          rpcReason === 'appointment_amount_unavailable'
        ) {
          return {
            ok: false,
            reason: 'payment_review_required',
            transient: false,
            localOrderId: localOrder.id,
          };
        }

        return { ok: false, reason: 'rpc_error', transient: false, localOrderId: localOrder.id };
      }

      console.log('Mercado Pago reconcile: pago conciliado', {
        localOrderId: localOrder.id,
        alreadyRecorded: row.already_recorded,
      });

      return {
        ok: true,
        outcome: row.already_recorded ? 'payment_already_recorded' : 'payment_recorded',
        localOrderId: localOrder.id,
        paymentId: row.payment_id,
      };
    } catch (err) {
      console.error('Mercado Pago reconcile: fallo llamando a record_mercadopago_payment', { localOrderId: localOrder.id }, err instanceof Error ? err.message : 'error desconocido');
      // Un error de RPC (por ejemplo, un problema transitorio de conexión a
      // la base) sí vale la pena reintentar — a diferencia de un ok:false
      // con `reason` explícito (arriba), que es una decisión, no un fallo.
      return { ok: false, reason: 'rpc_error', transient: true, localOrderId: localOrder.id };
    }
  }

  // F. Para estados no acreditados, sincronizar el status y, si Mercado Pago
  // confirma un refund o chargeback ya liquidado sobre un pago existente,
  // registrar el reverso contable de forma atómica e idempotente.
  const mappedStatus = mapRemoteStatusForLocalStorage(parsed.status);
  if (!mappedStatus) {
    console.error('Mercado Pago reconcile: status remoto no reconocido, no se actualiza nada', {
      localOrderId: localOrder.id,
      hadStatus: parsed.status !== null,
    });
    return { ok: false, reason: 'unexpected_remote_status', transient: false, localOrderId: localOrder.id };
  }

  let reversalsRecorded = 0;

  if (localOrder.payment_id) {
    const reversalCandidates = [
      ...parsed.refunds
        .filter((item) => item.status === 'processed')
        .map((item) => ({ ...item, kind: 'refund' as const })),
      ...(parsed.status === 'charged_back' && parsed.statusDetail === 'settled'
        ? parsed.chargebacks
            .filter((item) => item.status === 'settled')
            .map((item) => ({ ...item, kind: 'chargeback' as const }))
        : []),
    ];

    for (const reversal of reversalCandidates) {
      try {
        const { data, error } = await serviceClient.rpc('record_mercadopago_reversal', {
          p_mp_order_id: localOrder.mp_order_id,
          p_provider_reversal_id: reversal.id,
          p_kind: reversal.kind,
          p_amount: reversal.amount,
          p_provider_status: reversal.status,
        });
        if (error) throw error;

        const row = (Array.isArray(data) ? data[0] : data) as
          | { ok: boolean; reversal_id: string | null; already_recorded: boolean; reason: string | null }
          | undefined;

        if (!row?.ok || !row.reversal_id) {
          console.error('Mercado Pago reconcile: record_mercadopago_reversal devolvió ok=false', {
            localOrderId: localOrder.id,
            reason: row?.reason ?? 'unknown',
          });
          return {
            ok: false,
            reason: 'payment_review_required',
            transient: false,
            localOrderId: localOrder.id,
          };
        }

        if (!row.already_recorded) reversalsRecorded += 1;
      } catch (err) {
        console.error(
          'Mercado Pago reconcile: fallo registrando reverso',
          { localOrderId: localOrder.id, reversalKind: reversal.kind },
          err instanceof Error ? err.message : 'error desconocido',
        );
        return { ok: false, reason: 'rpc_error', transient: true, localOrderId: localOrder.id };
      }
    }
  }

  try {
    const { error } = await serviceClient
      .from('mercadopago_orders')
      .update({
        status: mappedStatus,
        status_detail: sanitizeStatusDetail(parsed.statusDetail),
        updated_at: new Date().toISOString(),
      })
      .eq('id', localOrder.id);
    if (error) throw error;
  } catch (err) {
    console.error('Mercado Pago reconcile: fallo actualizando el status de mercadopago_orders', { localOrderId: localOrder.id }, err instanceof Error ? err.message : 'error desconocido');
    return { ok: false, reason: 'internal_error', transient: true, localOrderId: localOrder.id };
  }

  return {
    ok: true,
    outcome: 'status_updated',
    localOrderId: localOrder.id,
    status: mappedStatus,
    reversalsRecorded: reversalsRecorded || undefined,
  };
}
