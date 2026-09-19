// Creación de órdenes de cobro de Mercado Pago Checkout Pro (Orders API)
// para un turno existente, usando la cuenta de Mercado Pago del PROFESIONAL
// dueño de ese turno (conectada vía OAuth, ver ./oauth.ts). Aislado del
// resto de la app: nada fuera de lib/mercadopago/ debe construir el body de
// la request a Mercado Pago ni tocar mercadopago_connections directamente.
//
// FASE 3 (esta fase): sólo crea la orden y devuelve un checkout_url. NO
// implementa webhooks, NO actualiza a "pagado", NO hace refunds, NO manda
// nada a ARCA, NO envía el link por WhatsApp, NO refresca el access_token
// si venció (eso es explícitamente una fase posterior — ver
// isConnectionUsable más abajo) y NO reconcilia nada. `payment_id` y
// `payment_recorded_at` en mercadopago_orders quedan sin tocar acá: son de
// una fase futura.
//
// Endpoint oficial (Checkout Pro, Orders API — no inventado):
//   POST https://api.mercadopago.com/v1/orders
//
// Reglas de seguridad de esta fase (ver pedido original):
//  - el access_token nunca llega al browser ni se loguea;
//  - mercadopago_connections sólo se lee con el cliente service-role;
//  - el amount SIEMPRE sale de la base (quoted_amount del turno o price del
//    servicio) — nunca de un valor recibido del cliente;
//  - idempotencia: un UUID generado server-side viaja como
//    X-Idempotency-Key y se persiste en mercadopago_orders.idempotency_key;
//  - external_reference es no sensible (deriva del appointment_id interno +
//    un sufijo aleatorio corto), máximo 64 caracteres, y se genera UNA NUEVA
//    en cada intento — mercadopago_orders tiene UNIQUE (tenant_id,
//    external_reference), así que una referencia estable rompería los
//    reintentos después de una orden 'failed';
//  - mercadopago_orders.status sólo se persiste con un valor de la
//    allowlist que exige su constraint (nunca el string crudo de Mercado
//    Pago);
//  - si Mercado Pago falla, la fila de mercadopago_orders se marca
//    'failed' pero nunca se toca la tabla payments;
//  - si ya existe una orden reutilizable para el turno (created/processing/
//    action_required con checkout_url), se reutiliza en vez de crear otra
//    (evita duplicados por doble click).

import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { decryptMercadoPagoToken, isMercadoPagoTokenEncryptionConfigured } from './token-crypto';

const MP_ORDERS_ENDPOINT = 'https://api.mercadopago.com/v1/orders';

// Estados de mercadopago_orders que cuentan como "todavía utilizable" para
// reutilizar un checkout existente en vez de generar otro (PARTE del pedido:
// evitar duplicados por doble click). Cualquier otro estado (failed,
// cancelled, expired, etc.) dispara la creación de una orden nueva.
const REUSABLE_ORDER_STATUSES = ['created', 'processing', 'action_required'];

// Turnos en estos estados no pueden generar cobro — mismos valores que
// lib/appointments/scheduling.ts / lib/labels.ts usan para "cancelado".
const CANCELLED_APPOINTMENT_STATUSES = ['cancelled', 'cancelado'];

// Allowlist EXACTA del constraint de mercadopago_orders.status. Nunca se
// persiste un valor fuera de esta lista, sea lo que sea que haya devuelto
// Mercado Pago — un status fuera de este conjunto rompería el UPDATE.
const MP_ORDER_STATUS_ALLOWLIST = ['created', 'processing', 'processed', 'action_required', 'failed', 'refunded', 'canceled'] as const;
type MercadoPagoOrderStatus = (typeof MP_ORDER_STATUS_ALLOWLIST)[number];

function isAllowedOrderStatus(value: unknown): value is MercadoPagoOrderStatus {
  return typeof value === 'string' && (MP_ORDER_STATUS_ALLOWLIST as readonly string[]).includes(value);
}

/**
 * Resuelve el status a persistir tras una creación exitosa en Mercado Pago:
 * si `rawStatus` está en la allowlist se usa tal cual; si no (ausente o un
 * valor que el constraint de la tabla no acepta), se usa 'created' — nunca
 * se persiste el valor crudo fuera de la allowlist.
 */
function resolveCreatedOrderStatus(rawStatus: unknown): MercadoPagoOrderStatus {
  return isAllowedOrderStatus(rawStatus) ? rawStatus : 'created';
}

export type CreateMercadoPagoCheckoutResult =
  | { ok: true; orderId: string; checkoutUrl: string }
  | { ok: false; reason: string; message: string };

type AppointmentRow = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  patient_id: string | null;
  service_id: string | null;
  status: string | null;
  quoted_amount: number | string | null;
  currency: string | null;
};

type ServiceRow = {
  name: string | null;
  price: number | string | null;
};

type MercadoPagoConnectionRow = {
  access_token_ciphertext: string;
  token_expires_at: string | null;
  revoked_at: string | null;
};

type ExistingOrderRow = {
  id: string;
  checkout_url: string | null;
  status: string | null;
};

type MercadoPagoOrderResponse = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  checkout_url?: string;
};

function fail(reason: string, message: string): CreateMercadoPagoCheckoutResult {
  return { ok: false, reason, message };
}

/**
 * `true` sólo si `value` es una URL https cuyo host es (un subdominio de)
 * mercadopago.com o mercadopago.com.ar. Nunca se acepta una URL arbitraria
 * como checkout_url, sea lo que sea que haya respondido el fetch — si esto
 * devuelve `false`, el caller trata la creación de la orden como fallida.
 */
function isTrustedMercadoPagoCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'mercadopago.com' || host.endsWith('.mercadopago.com') || host === 'mercadopago.com.ar' || host.endsWith('.mercadopago.com.ar');
}

/** Sanitiza un valor para guardarlo en status_detail: string corta, nunca el body completo ni nada que pueda contener un secreto. */
function sanitizeStatusDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

/**
 * external_reference no sensible: deriva del appointment_id interno (sin
 * guiones) + un sufijo aleatorio corto generado server-side. El sufijo es
 * necesario porque mercadopago_orders tiene UNIQUE (tenant_id,
 * external_reference) — sin él, un primer intento fallido (fila 'failed')
 * deja la referencia ocupada para siempre y el INSERT del reintento
 * fallaría. Cada llamada devuelve una referencia NUEVA; la reutilización de
 * una orden existente válida ya se resuelve antes de llegar a llamar a esto
 * (ver el chequeo de "orden reutilizable" más abajo). Longitud:
 * "turnia-" (7) + uuid sin guiones (32) + "-" (1) + 12 hex (12) = 52 ≤ 64.
 */
function buildExternalReference(appointmentId: string): string {
  const suffix = randomBytes(6).toString('hex'); // 12 caracteres hex, no sensible
  return `turnia-${appointmentId.replace(/-/g, '')}-${suffix}`;
}

/**
 * Crea (o reutiliza) una orden de cobro de Mercado Pago Checkout Pro para
 * `appointmentId`, usando la conexión OAuth de `userId` (el profesional
 * dueño del turno) dentro de `tenantId`. Nunca lanza: cualquier fallo se
 * devuelve como `{ ok: false, reason, message }` con `message` ya seguro
 * para mostrarle al usuario (nunca un error técnico ni datos de Mercado
 * Pago sin sanitizar).
 */
export async function createMercadoPagoCheckoutForAppointment(params: {
  tenantId: string;
  userId: string;
  appointmentId: string;
}): Promise<CreateMercadoPagoCheckoutResult> {
  const { tenantId, userId, appointmentId } = params;

  if (!isServiceRoleConfigured() || !isMercadoPagoTokenEncryptionConfigured()) {
    return fail('not_configured', 'La conexión con Mercado Pago no está configurada en el servidor todavía.');
  }

  const serviceClient = createSupabaseServiceClient();

  // A. Conexión del profesional — SIEMPRE con el cliente service-role,
  // nunca con el cliente RLS normal del usuario (mercadopago_connections
  // guarda tokens cifrados y está deliberadamente fuera del alcance de RLS
  // normal, igual que google_oauth_connections).
  let connection: MercadoPagoConnectionRow | null;
  try {
    const { data, error } = await serviceClient
      .from('mercadopago_connections')
      .select('access_token_ciphertext, token_expires_at, revoked_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    connection = data as MercadoPagoConnectionRow | null;
  } catch (err) {
    console.error('Mercado Pago orders: fallo leyendo mercadopago_connections', err instanceof Error ? err.message : 'error desconocido');
    return fail('internal_error', 'No pudimos generar el cobro. Probá de nuevo en unos minutos.');
  }

  if (!connection || connection.revoked_at) {
    return fail('not_connected', 'Este profesional todavía no tiene conectada su cuenta de Mercado Pago. Conectala desde Configuración.');
  }

  // REFRESH TOKEN: fuera de alcance de esta fase (ver comentario de
  // cabecera) — si el access_token venció, se falla claro y seguro, sin
  // intentar refrescarlo.
  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) {
    return fail('token_expired', 'La conexión con Mercado Pago venció. Volvé a conectarla desde Configuración.');
  }

  const decrypted = decryptMercadoPagoToken(connection.access_token_ciphertext);
  if (!decrypted.ok) {
    // Nunca se loguea el ciphertext ni ningún detalle del error de cifrado.
    console.error('Mercado Pago orders: no se pudo descifrar el access_token de la conexión');
    return fail('internal_error', 'No pudimos generar el cobro de forma segura. Probá de nuevo en unos minutos.');
  }
  const accessToken = decrypted.data;

  // B. Turno — service-role con filtros de tenant_id estrictos (mismo nivel
  // de aislamiento que le exigiríamos al cliente RLS normal, pero evita
  // depender de qué cliente tenga a mano el caller).
  let appointment: AppointmentRow | null;
  try {
    const { data, error } = await serviceClient
      .from('appointments')
      .select('id, tenant_id, professional_id, patient_id, service_id, status, quoted_amount, currency')
      .eq('id', appointmentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    appointment = data as AppointmentRow | null;
  } catch (err) {
    console.error('Mercado Pago orders: fallo leyendo appointments', err instanceof Error ? err.message : 'error desconocido');
    return fail('internal_error', 'No pudimos generar el cobro. Probá de nuevo en unos minutos.');
  }

  if (!appointment) {
    return fail('invalid_appointment', 'Turno inválido para este consultorio.');
  }

  // 7. El profesional autorizado para este turno es, en el modelo actual,
  // quien figura en appointments.professional_id — nunca se confía en que
  // "cualquier miembro del tenant" pueda generar el cobro con la conexión
  // de otro profesional.
  if (appointment.professional_id !== userId) {
    return fail('forbidden', 'No estás autorizado para generar un cobro de este turno.');
  }

  if (appointment.status && CANCELLED_APPOINTMENT_STATUSES.includes(appointment.status)) {
    return fail('cancelled_appointment', 'No se puede generar un cobro para un turno cancelado.');
  }

  // C. Amount: SIEMPRE server-side, nunca desde el browser. quoted_amount
  // del turno si es > 0; si no, price del servicio.
  let serviceRow: ServiceRow | null = null;
  if (appointment.service_id) {
    try {
      const { data, error: serviceError } = await serviceClient
        .from('services')
        .select('name, price')
        .eq('id', appointment.service_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      // No fatal: si no se puede leer el servicio, se sigue con el
      // fallback de título/price de abajo (quoted_amount / 'Turno
      // profesional'). Se loguea igual, sanitizado, para poder detectarlo.
      if (serviceError) {
        console.error('Mercado Pago orders: fallo leyendo services (no fatal)', { code: serviceError.code, message: serviceError.message });
      }
      serviceRow = data as ServiceRow | null;
    } catch {
      serviceRow = null;
    }
  }

  const quotedAmount = appointment.quoted_amount != null ? Number(appointment.quoted_amount) : 0;
  const servicePrice = serviceRow?.price != null ? Number(serviceRow.price) : 0;
  const amount = quotedAmount > 0 ? quotedAmount : servicePrice;

  if (!Number.isFinite(amount) || amount <= 0) {
    return fail('no_amount', 'Este turno no tiene un monto configurado. Asigná un precio antes de generar el cobro.');
  }

  // Moneda ARS por ahora (ver pedido original) — no se toma de
  // appointment.currency/service.price para no introducir multi-moneda sin
  // que esté explícitamente pedido.
  const currency = 'ARS';
  const amountStr = amount.toFixed(2);
  const itemTitle = serviceRow?.name?.trim() || 'Turno profesional';

  // IMPORTANTE: si ya existe una orden reutilizable para este turno, se
  // devuelve esa en vez de crear otra (evita duplicados por doble click).
  try {
    const { data: existing, error: existingError } = await serviceClient
      .from('mercadopago_orders')
      .select('id, checkout_url, status')
      .eq('tenant_id', tenantId)
      .eq('appointment_id', appointmentId)
      .not('checkout_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (existingError) throw existingError;

    const reusable = (existing as ExistingOrderRow[] | null)?.find(
      (row) => row.status && REUSABLE_ORDER_STATUSES.includes(row.status) && isTrustedMercadoPagoCheckoutUrl(row.checkout_url)
    );
    if (reusable && reusable.checkout_url) {
      return { ok: true, orderId: reusable.id, checkoutUrl: reusable.checkout_url };
    }
  } catch (err) {
    console.error('Mercado Pago orders: fallo buscando orden existente', err instanceof Error ? err.message : 'error desconocido');
    return fail('internal_error', 'No pudimos generar el cobro. Probá de nuevo en unos minutos.');
  }

  const idempotencyKey = randomUUID();
  const externalReference = buildExternalReference(appointmentId);
  const nowIso = new Date().toISOString();

  // D. Fila local ANTES de llamar a Mercado Pago. Si esto falla, nunca se
  // llega a llamar a la API de Mercado Pago.
  let orderRowId: string;
  try {
    const { data: created, error } = await serviceClient
      .from('mercadopago_orders')
      .insert({
        tenant_id: tenantId,
        professional_id: userId,
        appointment_id: appointmentId,
        patient_id: appointment.patient_id,
        amount,
        currency,
        status: 'created',
        external_reference: externalReference,
        idempotency_key: idempotencyKey,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single();
    if (error || !created) throw error ?? new Error('insert sin fila devuelta');
    orderRowId = created.id as string;
  } catch (err) {
    console.error('Mercado Pago orders: fallo creando la fila local de la orden', err instanceof Error ? err.message : 'error desconocido');
    return fail('internal_error', 'No pudimos generar el cobro. Probá de nuevo en unos minutos.');
  }

  // E. Crear la orden en Mercado Pago. Nunca se envían datos clínicos, notas
  // del turno ni información del paciente — sólo título de servicio (o un
  // texto neutro) y montos.
  let mpResponse: MercadoPagoOrderResponse | null = null;
  let networkOrParseFailed = false;
  try {
    const response = await fetch(MP_ORDERS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'manual',
        total_amount: amountStr,
        external_reference: externalReference,
        description: 'Turno TurnIA',
        items: [
          {
            title: itemTitle,
            quantity: 1,
            unit_price: amountStr,
            total_amount: amountStr,
            unit_measure: 'unit',
          },
        ],
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.id) {
      // A. Sanitizado: nunca se guarda el body completo, sólo status HTTP +
      // (si vino) status_detail de Mercado Pago, acotado. El UPDATE puede
      // devolver `{ error }` sin lanzar — se inspecciona explícitamente; si
      // falla, sólo queda logueado (la fila ya insertada sigue en
      // 'created', lo cual es honesto: no sabemos si MP la aceptó o no).
      const { error: markFailedError } = await serviceClient
        .from('mercadopago_orders')
        .update({
          status: 'failed',
          status_detail: sanitizeStatusDetail(json?.status_detail || json?.message || `http_${response.status}`),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderRowId);
      if (markFailedError) {
        console.error('Mercado Pago orders: fallo marcando la orden como failed (provider_error)', {
          code: markFailedError.code,
          message: markFailedError.message,
        });
      }
      return fail('provider_error', 'No se pudo generar el cobro con Mercado Pago. Probá de nuevo en unos minutos.');
    }
    mpResponse = json as MercadoPagoOrderResponse;
  } catch (err) {
    networkOrParseFailed = true;
    console.error('Mercado Pago orders: fallo de red creando la orden', err instanceof Error ? err.message : 'error desconocido');
  }

  if (networkOrParseFailed || !mpResponse) {
    // B. Mismo criterio que A: chequeo explícito del `{ error }` del UPDATE.
    const { error: markNetworkErrorFailed } = await serviceClient
      .from('mercadopago_orders')
      .update({ status: 'failed', status_detail: 'network_error', updated_at: new Date().toISOString() })
      .eq('id', orderRowId);
    if (markNetworkErrorFailed) {
      console.error('Mercado Pago orders: fallo marcando la orden como failed (network_error)', {
        code: markNetworkErrorFailed.code,
        message: markNetworkErrorFailed.message,
      });
    }
    return fail('network_error', 'No se pudo generar el cobro con Mercado Pago. Probá de nuevo en unos minutos.');
  }

  // F. checkout_url validado ANTES de confiar en él — nunca se acepta una
  // URL arbitraria como si fuera de Mercado Pago.
  if (!isTrustedMercadoPagoCheckoutUrl(mpResponse.checkout_url)) {
    // C. Mismo criterio que A/B.
    const { error: markInvalidUrlFailed } = await serviceClient
      .from('mercadopago_orders')
      .update({
        mp_order_id: mpResponse.id != null ? String(mpResponse.id) : null,
        status: 'failed',
        status_detail: 'invalid_checkout_url',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderRowId);
    if (markInvalidUrlFailed) {
      console.error('Mercado Pago orders: fallo marcando la orden como failed (invalid_checkout_url)', {
        code: markInvalidUrlFailed.code,
        message: markInvalidUrlFailed.message,
      });
    }
    return fail('provider_error', 'No se pudo generar el cobro con Mercado Pago. Probá de nuevo en unos minutos.');
  }

  // Status final: SIEMPRE de la allowlist que exige el constraint de la
  // columna — nunca el valor crudo de mpResponse.status.
  const finalStatus = resolveCreatedOrderStatus(mpResponse.status);
  const finalStatusDetail =
    isAllowedOrderStatus(mpResponse.status)
      ? sanitizeStatusDetail(mpResponse.status_detail)
      : sanitizeStatusDetail(mpResponse.status_detail) ?? sanitizeStatusDetail(`unexpected_status:${mpResponse.status ?? 'none'}`);

  // D. Mercado Pago YA creó la orden remota en este punto (tenemos
  // mpResponse.id y un checkout_url ya validado como de Mercado Pago). El
  // UPDATE puede devolver `{ error }` sin lanzar — se inspecciona
  // explícitamente. Si falla, NUNCA se devuelve ok:true como si hubiera
  // quedado persistido: eso dejaría al profesional (y a nosotros) sin forma
  // de volver a encontrar ese checkout_url. Tampoco se reintenta el POST a
  // Mercado Pago en este mismo request (crearía el riesgo de una segunda
  // orden remota). Esta orden remota queda pendiente de reconciliación
  // manual/futura: la fila local sigue existiendo con status='created',
  // external_reference e idempotency_key, así que un proceso de
  // reconciliación posterior podría recuperarla contra la API de Mercado
  // Pago por external_reference. Nunca se loguea el access_token ni el body
  // completo de la respuesta de Mercado Pago.
  const { error: persistError } = await serviceClient
    .from('mercadopago_orders')
    .update({
      mp_order_id: String(mpResponse.id),
      checkout_url: mpResponse.checkout_url,
      status: finalStatus,
      status_detail: finalStatusDetail,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderRowId);

  if (persistError) {
    console.error('Mercado Pago orders: MP creó la orden pero no se pudo persistir el resultado local — requiere reconciliación', {
      code: persistError.code,
      message: persistError.message,
    });
    return fail(
      'persist_failed',
      'Se generó el cobro en Mercado Pago pero no pudimos guardarlo. Probá de nuevo en unos minutos o contactá soporte.'
    );
  }

  // H.
  return { ok: true, orderId: orderRowId, checkoutUrl: mpResponse.checkout_url as string };
}

export type MercadoPagoOrderSummary = { appointmentId: string; checkoutUrl: string };

/**
 * Para un conjunto de turnos visibles (por ejemplo, los del día en Agenda),
 * devuelve un mapa appointment_id -> checkout_url para las órdenes todavía
 * reutilizables (created/processing/action_required, con checkout_url).
 * SIEMPRE con el cliente service-role — igual que el resto de este archivo,
 * mercadopago_orders no se lee con el cliente RLS normal del usuario desde
 * fuera de lib/mercadopago/, para no depender de qué políticas de RLS tenga
 * hoy esa tabla.
 */
export async function getReusableMercadoPagoCheckoutsForAppointments(params: {
  tenantId: string;
  appointmentIds: string[];
}): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (params.appointmentIds.length === 0) return result;
  if (!isServiceRoleConfigured()) return result;

  try {
    const serviceClient = createSupabaseServiceClient();
    const { data, error } = await serviceClient
      .from('mercadopago_orders')
      .select('appointment_id, checkout_url, status, created_at')
      .eq('tenant_id', params.tenantId)
      .in('appointment_id', params.appointmentIds)
      .in('status', REUSABLE_ORDER_STATUSES)
      .not('checkout_url', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    for (const row of (data ?? []) as { appointment_id: string; checkout_url: string | null }[]) {
      // El primero por appointment_id en este orden (created_at desc) es el
      // más reciente — como ya viene ordenado, no se sobreescribe si ya hay
      // uno guardado para ese turno.
      if (row.checkout_url && isTrustedMercadoPagoCheckoutUrl(row.checkout_url) && !result.has(row.appointment_id)) {
        result.set(row.appointment_id, row.checkout_url);
      }
    }
  } catch (err) {
    console.error('Mercado Pago orders: fallo leyendo órdenes reutilizables', err instanceof Error ? err.message : 'error desconocido');
    return new Map();
  }

  return result;
}
