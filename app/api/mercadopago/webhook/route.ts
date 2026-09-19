// Webhook público de Mercado Pago (Checkout Pro / Orders API).
//
// URL pública a configurar en Mercado Pago (Developer Dashboard > la app >
// Webhooks), o la que Mercado Pago use automáticamente para notificaciones
// de una integración conectada por OAuth:
//   https://<dominio>/api/mercadopago/webhook
//
// Alcance de ESTA implementación (ver tarea original): sólo dejar la
// recepción del webhook funcionando de forma segura y sin romper con los
// eventos reales que manda Mercado Pago (incluyendo eventos de prueba como
// "application.authorized" / type "mp-connect"). NO cambia estados de
// turnos ni pagos en Supabase todavía — eso es una fase posterior que va a
// reutilizar este mismo handler. NO valida todavía la firma criptográfica
// del header `x-signature` contra un secreto — ver el comentario de
// `MP_WEBHOOK_SECRET` más abajo: eso queda para el siguiente paso, a
// propósito.
//
// Variable de entorno relevante para la fase siguiente (todavía NO se lee
// ni se exige acá):
//   MP_WEBHOOK_SECRET   secret key de la app de Mercado Pago (Developer
//                        Dashboard > Webhooks > Secret key), usado para
//                        validar la firma HMAC-SHA256 del header
//                        `x-signature` (formato "ts=<timestamp>,v1=<hex>").
//                        Mientras no exista este código de validación, el
//                        endpoint acepta cualquier POST bien formado — no
//                        hay todavía protección criptográfica real.
//
// Logs de este archivo: deliberadamente mínimos y sanitizados. Nunca se
// loguea el body completo, la firma completa (`x-signature`), tokens, ni
// datos de pacientes/pagos — sólo identificadores técnicos no sensibles
// (action, type, data.id, live_mode, x-request-id) para poder diagnosticar
// problemas de integración sin exponer nada sensible.

import { NextRequest, NextResponse } from 'next/server';

// Ruta 100% dinámica: no debe cachearse ni pre-renderizarse (mismo criterio
// que el webhook de WhatsApp).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Tipo mínimo del payload de notificaciones de Mercado Pago (sólo lo que
// este endpoint necesita reconocer para loguear de forma segura; no es un
// tipado exhaustivo de todos los eventos que Mercado Pago puede mandar).
// Ejemplo real de evento de prueba:
//   { "action": "application.authorized", "api_version": "v1",
//     "data": { "id": "123456" }, "live_mode": false, "type": "mp-connect",
//     "user_id": 176611236 }
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
  // Body como texto primero (no request.json()): la validación de firma de
  // la fase siguiente va a necesitar el string crudo exacto que Mercado
  // Pago firmó, igual que ya hacemos en el webhook de WhatsApp.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    console.error('Mercado Pago webhook: no se pudo leer el body del request');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Headers relevantes. `x-signature` NUNCA se loguea completo (ni siquiera
  // en la fase siguiente, cuando se valide): acá sólo se registra si vino
  // presente o no. `x-request-id` sí es seguro de loguear (es un
  // identificador técnico de Mercado Pago, no un secreto).
  const hasSignature = request.headers.get('x-signature') !== null;
  const requestId = request.headers.get('x-request-id');

  // Query params — Mercado Pago manda `data.id`/`type` (o, en el formato
  // más viejo, `id`/`topic`) como query string además de en el body, según
  // el tipo de notificación. Se leen ambos formatos, siempre de forma
  // opcional (pueden no venir).
  const { searchParams } = request.nextUrl;
  const queryDataId = searchParams.get('data.id') ?? searchParams.get('id');
  const queryType = searchParams.get('type') ?? searchParams.get('topic');

  // MP_WEBHOOK_SECRET: a propósito NO se lee ni se exige todavía (ver
  // comentario de cabecera). No hay validación criptográfica de
  // `x-signature` en esta fase — queda explícitamente para el siguiente
  // paso, sin inventar un secreto ni bloquear pruebas por su ausencia.

  const payload = parseWebhookPayload(rawBody);

  // Log seguro: sólo identificadores técnicos no sensibles. Nunca el body
  // completo, nunca la firma, nunca tokens.
  console.log('Mercado Pago webhook received', {
    action: payload?.action,
    type: payload?.type ?? queryType ?? undefined,
    dataId: payload?.data?.id ?? queryDataId ?? undefined,
    liveMode: payload?.live_mode,
    requestId,
    hasSignature,
  });

  if (payload === null && rawBody) {
    // Body no vacío pero no es JSON válido (o no es un objeto) — se deja
    // registrado, pero se responde 200 igual: no hay nada que reintentando
    // se vaya a resolver, y devolver un error acá sólo generaría reintentos
    // innecesarios de Mercado Pago (mismo criterio que el webhook de
    // WhatsApp).
    console.warn('Mercado Pago webhook: payload no es JSON válido o no es un objeto');
  }

  // TODO (fase siguiente, fuera de este alcance): validar `x-signature`
  // contra MP_WEBHOOK_SECRET y, sólo si es válida, actualizar el estado del
  // pago/turno correspondiente en Supabase (mercadopago_orders / payments)
  // usando `data.id` para buscar el recurso en la API de Mercado Pago. Por
  // ahora este endpoint sólo confirma la recepción.

  return NextResponse.json({ received: true }, { status: 200 });
}
