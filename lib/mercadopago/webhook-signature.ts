// Verificación de la firma `x-signature` de las notificaciones (webhooks)
// de Mercado Pago — funciones puras, sin acceso a process.env ni a
// Next.js, para poder testear y reutilizar esta lógica de forma aislada.
// Único caller hoy: app/api/mercadopago/webhook/route.ts.
//
// Formato oficial documentado por Mercado Pago (Developers > Notificaciones
// > Webhooks — sección "Cómo validar el origen de las notificaciones"):
//
//   Header `x-signature`: "ts=<timestamp>,v1=<hmac-sha256 en hex>"
//
//   Manifest (el string exacto que Mercado Pago firma con HMAC-SHA256,
//   usando el Secret Key configurado en el Developer Dashboard de la app,
//   sección Webhooks):
//     "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
//
//   Reglas exactas de esa construcción, según la misma documentación:
//   - <data.id> es el valor del query param `data.id` de la URL de
//     notificación (no el del body), EN MINÚSCULAS.
//   - Si `data.id` o `x-request-id` no vinieron en la notificación, ese
//     segmento se omite POR COMPLETO del manifest (ni siquiera aparece el
//     nombre del campo) — nunca se reemplaza por un string vacío.
//   - El segmento `ts` siempre está presente (viene del propio header
//     `x-signature`, que ya es obligatorio para poder validar cualquier
//     cosa).
//   - El orden de los campos (id, luego request-id, luego ts) y el `;`
//     final de cada segmento presente son exactos, tal como los documenta
//     Mercado Pago — no se inventó ningún separador ni orden alternativo.
//
// Importante: a diferencia de la firma de WhatsApp/Meta (HMAC sobre el body
// completo), la firma de Mercado Pago NO cubre el body de la notificación —
// sólo cubre `data.id` (query), `x-request-id` (header) y `ts` (dentro del
// propio header `x-signature`). Por eso esta validación puede hacerse antes
// de leer el body.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type MercadoPagoParsedSignature = {
  ts: string;
  v1: string;
};

/**
 * Parsea el header `x-signature` de Mercado Pago: "ts=...,v1=...".
 * Devuelve `null` si el header falta, está vacío, o no contiene AMBOS
 * campos (`ts` y `v1`) con un valor no vacío. Tolera espacios alrededor de
 * las comas/igual (la documentación no los exige, pero tampoco los
 * prohíbe, y así es más tolerante sin dejar de ser estricto en lo que
 * importa: que ambos campos estén presentes y no vacíos).
 */
export function parseMercadoPagoSignature(header: string | null | undefined): MercadoPagoParsedSignature | null {
  if (!header) return null;

  let ts: string | null = null;
  let v1: string | null = null;

  for (const part of header.split(',')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (!value) continue;
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }

  if (!ts || !v1) return null;
  return { ts, v1 };
}

/**
 * Construye el manifest exacto que Mercado Pago firma, según el formato
 * documentado (ver comentario de cabecera de este archivo). `dataId` se
 * normaliza a minúsculas acá adentro (no es responsabilidad del caller).
 * `dataId`/`requestId` pueden venir `null`/`undefined`/vacíos — en ese caso
 * ese segmento se omite del manifest por completo, tal como exige la
 * documentación oficial (nunca se emite un segmento con valor vacío).
 */
export function buildMercadoPagoManifest(params: { dataId?: string | null; requestId?: string | null; ts: string }): string {
  let manifest = '';
  if (params.dataId) {
    manifest += `id:${params.dataId.toLowerCase()};`;
  }
  if (params.requestId) {
    manifest += `request-id:${params.requestId};`;
  }
  manifest += `ts:${params.ts};`;
  return manifest;
}

/**
 * Verifica una firma `x-signature` de Mercado Pago contra `secret` (el
 * valor de `MP_WEBHOOK_SECRET`). Nunca lanza: devuelve `false` ante
 * cualquier problema (header ausente/malformado, secret vacío, HMAC que no
 * coincide). Usa `timingSafeEqual` para la comparación final — nunca una
 * comparación directa de strings (`===`) — mismo criterio que ya aplica
 * `isValidMetaSignature` en app/api/whatsapp/webhook/route.ts.
 */
export function verifyMercadoPagoSignature(params: {
  signatureHeader: string | null | undefined;
  requestId?: string | null;
  dataId?: string | null;
  secret: string;
}): boolean {
  if (!params.secret) return false;

  const parsed = parseMercadoPagoSignature(params.signatureHeader);
  if (!parsed) return false;

  const manifest = buildMercadoPagoManifest({ dataId: params.dataId, requestId: params.requestId, ts: parsed.ts });
  const expectedHex = createHmac('sha256', params.secret).update(manifest).digest('hex');

  // v1 debe ser hex válido de la misma longitud que expectedHex (SHA-256 =
  // 64 caracteres hex) antes de convertir a Buffer — mismo chequeo
  // defensivo que ya usa el webhook de WhatsApp contra hex inválido o de
  // longitud incorrecta (Buffer.from con hex inválido trunca en vez de
  // lanzar, así que se valida el formato explícitamente antes).
  if (!/^[0-9a-fA-F]+$/.test(parsed.v1) || parsed.v1.length !== expectedHex.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(parsed.v1, 'hex'), Buffer.from(expectedHex, 'hex'));
}
