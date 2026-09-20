// Webhook público de Mercado Pago (Checkout Pro / Orders API).
//
// URL pública configurada en Mercado Pago (Developer Dashboard > la app >
// Webhooks), y la que Mercado Pago usa automáticamente para notificaciones
// de una integración conectada por OAuth:
//   https://<dominio>/api/mercadopago/webhook
//
// Ya validado en producción antes de esta fase: Mercado Pago confirmó una
// prueba real con HTTP 200.
//
// Alcance de ESTA implementación (ver tarea original): validar
// criptográficamente la firma `x-signature` de cada notificación entrante.
// Explícitamente NO todavía: no actualiza Supabase, no modifica pagos ni
// turnos, no llama a la API de Mercado Pago, no implementa ninguna lógica
// de negocio — sólo confirma de forma segura que la notificación es
// auténtica y responde `{ received: true }`.
//
// Formato de la firma y construcción exacta del manifest: ver
// lib/mercadopago/webhook-signature.ts (funciones puras, con la
// documentación oficial citada ahí).
//
// Variable de entorno:
//   MP_WEBHOOK_SECRET   Secret Key de Webhooks de la app de Mercado Pago
//                        (Developer Dashboard > la app > Webhooks > "Secret
//                        key"). OBLIGATORIA: sin ella, este endpoint
//                        rechaza TODOS los POST — no existe un modo que
//                        acepte notificaciones sin validar la firma, mismo
//                        criterio que WHATSAPP_APP_SECRET en
//                        app/api/whatsapp/webhook/route.ts.
//
// Logs de este archivo: deliberadamente mínimos y sanitizados. Nunca se
// loguea MP_WEBHOOK_SECRET, el header `x-signature` completo, tokens, ni
// datos de pacientes/pagos — sólo identificadores técnicos no sensibles
// (action, type, data.id, live_mode, x-request-id) y si la firma resultó
// válida o no.

import { NextRequest, NextResponse } from 'next/server';
import { verifyMercadoPagoSignature } from '@/lib/mercadopago/webhook-signature';

// Ruta 100% dinámica: no debe cachearse ni pre-renderizarse (mismo criterio
// que el webhook de WhatsApp).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Tipo mínimo del payload de notificaciones de Mercado Pago (sólo lo que
// este endpoint necesita reconocer para loguear de forma segura; no es un
// tipado exhaustivo de todos los eventos que Mercado Pago puede mandar).
// Ejemplo real de evento de prueba del panel:
//   { "action": "application.authorized", "api_version": "v1",
//     "data": { "id": "123456" }, "date_created": "2021-11-01T02:02:02Z",
//     "id": "123456", "live_mode": false, "type": "mp-connect",
//     "user_id": 176611236 }
// El evento real principal esperado en esta integración es de tipo
// "order"/"orders" (creación de una orden de Checkout Pro).
// ---------------------------------------------------------------------------

type MercadoPagoWebhookPayload = {
  action?: string;
  api_version?: string;
  data?: { id?: string | number };
  live_mode?: boolean;
  type?: string;
  user_id?: string | number;
};

/**
 * Extrae de forma segura un campo escalar (string/number/boolean) de un
 * valor `unknown` recién parseado, o `undefined` si no está presente o no
 * es del tipo esperado. Nunca asume la forma completa del payload.
 */
function readScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function parseWebhookPayload(rawBody: string): MercadoPagoWebhookPayload | null {
  if (!rawBody) return null;
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;

  const obj = json as Record<string, unknown>;
  const dataRaw = obj.data;
  const data =
    typeof dataRaw === 'object' && dataRaw !== null
      ? { id: readScalar((dataRaw as Record<string, unknown>).id) as string | number | undefined }
      : undefined;

  return {
    action: typeof obj.action === 'string' ? obj.action : undefined,
    api_version: typeof obj.api_version === 'string' ? obj.api_version : undefined,
    data,
    live_mode: typeof obj.live_mode === 'boolean' ? obj.live_mode : undefined,
    type: typeof obj.type === 'string' ? obj.type : undefined,
    user_id: readScalar(obj.user_id) as string | number | undefined,
  };
}

// ---------------------------------------------------------------------------
// POST — recepción de notificaciones de Mercado Pago.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Headers y query params se leen ANTES del body: la firma de Mercado
  // Pago NO cubre el body (a diferencia de Meta/WhatsApp) — sólo cubre
  // `data.id` (query), `x-request-id` (header) y `ts` (dentro del propio
  // `x-signature`), así que se puede validar sin leer el body todavía.
  // `x-signature` NUNCA se loguea completo — sólo si vino presente, y el
  // resultado final de la validación.
  const signatureHeader = request.headers.get('x-signature');
  const requestId = request.headers.get('x-request-id');
  const { searchParams } = request.nextUrl;

  // `data.id` para la FIRMA: exactamente el query param que documenta
  // Mercado Pago (`data.id`), sin fallback al formato viejo (`id`) — ese
  // formato viejo no forma parte del manifest documentado, así que usarlo
  // ahí sería inventar el esquema. El fallback a `id` sólo se usa más abajo
  // para LOGUEAR, nunca para calcular la firma.
  const signatureDataId = searchParams.get('data.id');

  const webhookSecret = process.env.MP_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Sin el secreto no hay forma de validar que la notificación vino
    // realmente de Mercado Pago — se rechaza SIEMPRE (no sólo en
    // producción, y sin excepción para eventos de prueba): mismo criterio
    // ya aplicado a WHATSAPP_APP_SECRET en el webhook de WhatsApp. Nunca se
    // loguea nada sensible, sólo que falta la configuración.
    console.error('Mercado Pago webhook: MP_WEBHOOK_SECRET no configurado, notificación rechazada');
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  }

  const signatureValid = verifyMercadoPagoSignature({
    signatureHeader,
    requestId,
    dataId: signatureDataId,
    secret: webhookSecret,
  });

  if (!signatureValid) {
    // No se registra el header de firma ni el manifest calculado — sólo
    // que fue rechazada, más los identificadores técnicos no sensibles ya
    // disponibles sin leer el body.
    console.warn('Mercado Pago webhook: firma x-signature ausente o inválida, notificación rechazada', {
      hasSignature: signatureHeader !== null,
      requestId,
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // A partir de acá la notificación ya está verificada como auténtica.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    console.error('Mercado Pago webhook: no se pudo leer el body del request (firma ya validada)');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const queryDataId = signatureDataId ?? searchParams.get('id');
  const queryType = searchParams.get('type') ?? searchParams.get('topic');
  const payload = parseWebhookPayload(rawBody);

  // Log seguro: sólo identificadores técnicos no sensibles, más el
  // resultado de la validación. Nunca el body completo, nunca la firma,
  // nunca tokens.
  console.log('Mercado Pago webhook received', {
    action: payload?.action,
    type: payload?.type ?? queryType ?? undefined,
    dataId: payload?.data?.id ?? queryDataId ?? undefined,
    liveMode: payload?.live_mode,
    requestId,
    signatureValid: true,
  });

  if (payload === null && rawBody) {
    // Body no vacío pero no es JSON válido (o no es un objeto). Se deja
    // registrado, pero se responde 200 igual: no hay nada que reintentando
    // se vaya a resolver, y devolver un error acá sólo generaría reintentos
    // innecesarios de Mercado Pago (mismo criterio que el webhook de
    // WhatsApp).
    console.warn('Mercado Pago webhook: payload no es JSON válido o no es un objeto');
  }

  // TODO (fase siguiente, fuera de este alcance): usar `data.id` para
  // buscar el recurso en la API de Mercado Pago y actualizar el estado del
  // pago/turno correspondiente en Supabase (mercadopago_orders / payments).
  // Por ahora este endpoint sólo valida la firma y confirma la recepción.

  return NextResponse.json({ received: true }, { status: 200 });
}
