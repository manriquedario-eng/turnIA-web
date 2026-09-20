// Webhook oficial de Meta WhatsApp Cloud API.
//
// URL pública que debe configurarse en Meta (App > WhatsApp > Configuration):
//   https://turn-ia-web.vercel.app/api/whatsapp/webhook
//
// GET  -> Verificación del webhook (Meta la llama una vez al guardar la
//         configuración, y cada vez que se re-verifica).
// POST -> Recepción de eventos (mensajes entrantes y actualizaciones de
//         estado de mensajes salientes).
//
// Alcance de esta implementación (ver tarea original): sólo dejar el
// webhook operativo y seguro. NO incluye chatbot, respuestas automáticas,
// IA, almacenamiento de conversaciones, ni ninguna lógica de negocio sobre
// pacientes/turnos. Eso queda para fases futuras — ver comentarios "TODO"
// en el handler de POST.
//
// Variables de entorno (server-side únicamente, nunca NEXT_PUBLIC_):
//   WHATSAPP_VERIFY_TOKEN   token arbitrario que vos elegís y configurás
//                           IGUAL en Vercel y en Meta, usado sólo para la
//                           verificación GET. No es un secreto de firma.
//   WHATSAPP_APP_SECRET     OBLIGATORIO para aceptar cualquier POST. App
//                           Secret de la app de Meta, usado para validar la
//                           firma X-Hub-Signature-256 de cada evento. Ver
//                           `isValidMetaSignature` más abajo. Si falta, el
//                           POST se rechaza con 403 — no existe un "modo
//                           inseguro" que acepte eventos sin validar la
//                           firma. No se acepta META_APP_SECRET como alias
//                           (ver razón en el comentario de la función).
//
// Ninguna de estas variables se hardcodea ni se versiona: se leen sólo
// desde process.env en tiempo de ejecución server-side. Los logs de este
// archivo son deliberadamente mínimos: nunca imprimen tokens, secretos, el
// body completo del request, ni contenido de mensajes.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Ruta 100% dinámica: no debe cachearse ni pre-renderizarse, y no depende
// de filesystem local ni de procesos en segundo plano (compatible con el
// runtime serverless de Vercel).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Tipos mínimos de los eventos de WhatsApp Cloud API (sólo lo que este
// endpoint necesita reconocer; no es un tipado exhaustivo del payload de
// Meta).
// ---------------------------------------------------------------------------

type WhatsAppInboundMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
};

type WhatsAppMessageStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | (string & {});
  timestamp: string;
  recipient_id: string;
};

type WhatsAppChangeValue = {
  messaging_product?: 'whatsapp';
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppMessageStatus[];
};

type WhatsAppChange = {
  field: string;
  value: WhatsAppChangeValue;
};

type WhatsAppEntry = {
  id: string;
  changes?: WhatsAppChange[];
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: WhatsAppEntry[];
};

// ---------------------------------------------------------------------------
// GET — verificación del webhook (Meta Cloud API "hub challenge").
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const verifyTokenParam = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  const isValid =
    mode === 'subscribe' &&
    !!expectedToken &&
    !!verifyTokenParam &&
    verifyTokenParam === expectedToken &&
    !!challenge;

  if (isValid) {
    // Meta espera el challenge devuelto tal cual, como texto plano.
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // No revelar por qué falló (token ausente vs. inválido vs. modo
  // incorrecto): siempre 403 sin cuerpo.
  return new NextResponse(null, { status: 403 });
}

// ---------------------------------------------------------------------------
// Validación de firma X-Hub-Signature-256 (obligatoria)
// ---------------------------------------------------------------------------
//
// Meta firma cada POST con HMAC-SHA256 sobre el body crudo, usando el App
// Secret de la app de Meta como clave, y lo manda en el header
// `X-Hub-Signature-256: sha256=<hex>`. Ver:
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validating-payloads
//
// Hallazgo de seguridad cerrado en esta pasada: antes, si WHATSAPP_APP_SECRET
// no estaba configurado, esta función devolvía `true` y el POST se aceptaba
// sin validar ninguna firma — cualquiera que conociera la URL del webhook
// podía mandar eventos falsos. Ahora WHATSAPP_APP_SECRET es obligatorio: la
// ausencia de la variable se resuelve ANTES de llegar a esta función (ver
// el handler de POST más abajo), rechazando el evento con 403. Esta función
// asume que `appSecret` ya es un string no vacío — no vuelve a leer
// `process.env` ni contempla el caso "sin secreto configurado".
//
// Por qué se eliminó META_APP_SECRET como alias: tener dos nombres de
// variable válidos para el mismo secreto obligatorio no aporta nada una vez
// que la validación es obligatoria — sólo aumenta el riesgo de que alguien
// configure el secreto bajo el nombre "equivocado" en Vercel y el webhook
// quede rechazando todo (o, peor, que en algún momento futuro alguien
// reintroduzca sin querer el fallback inseguro al tocar este código).
// WHATSAPP_APP_SECRET es el único nombre documentado en `.env.example` y en
// los comentarios de este archivo; no hay ningún otro consumidor de
// META_APP_SECRET en el proyecto.
function isValidMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const providedHex = signatureHeader.slice('sha256='.length);

  // Validación explícita de formato hex ANTES de convertir: Buffer.from con
  // hex inválido (caracteres no hex, o longitud impar) no tira excepción —
  // trunca silenciosamente en el primer carácter inválido, lo que podría
  // producir un buffer más corto y, en teoría, comportamiento no evidente.
  // Se rechaza explícitamente acá en vez de depender de ese truncamiento.
  if (!/^[0-9a-fA-F]+$/.test(providedHex) || providedHex.length % 2 !== 0) {
    return false;
  }

  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // Longitud incorrecta: timingSafeEqual requiere buffers del mismo tamaño
  // (SHA-256 siempre produce 32 bytes / 64 caracteres hex; cualquier otra
  // longitud ya es inválida).
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// POST — recepción de eventos (mensajes entrantes y estados de mensajes).
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Se lee el body como texto primero (no con request.json()) porque la
  // validación de firma necesita el string crudo exacto que Meta firmó.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    // No se pudo ni leer el body. Responder 200 igual: no hay nada más que
    // hacer, y devolver un error acá sólo provocaría reintentos inútiles de
    // Meta ante un problema que no se va a resolver reintentando.
    console.error('WhatsApp webhook: no se pudo leer el body del request');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // WHATSAPP_APP_SECRET es obligatorio para aceptar cualquier POST — ver
  // comentario de `isValidMetaSignature` más arriba. Sin esta variable, no
  // hay forma de validar que el evento realmente vino de Meta, así que se
  // rechaza siempre, sin excepción. Nunca se loguea el secreto, la firma
  // recibida, el body ni contenido de mensajes — sólo este mensaje genérico.
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error('WhatsApp webhook: App Secret no configurado, evento rechazado');
    return NextResponse.json({ error: 'app_secret_not_configured' }, { status: 403 });
  }

  if (!isValidMetaSignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) {
    // No registrar el header de firma ni el body: sólo que fue rechazado.
    console.warn('WhatsApp webhook: firma X-Hub-Signature-256 inválida, evento rechazado');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 403 });
  }

  console.log('WhatsApp webhook received');

  let payload: WhatsAppWebhookPayload | null = null;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as WhatsAppWebhookPayload) : null;
  } catch {
    payload = null;
  }

  if (!payload || payload.object !== 'whatsapp_business_account') {
    // Payload malformado o de un objeto que este endpoint no espera.
    // Se responde 200 igual: es tráfico que no vamos a poder procesar
    // reintentando, así que devolver un error sólo generaría reintentos
    // innecesarios de Meta (ver punto 2 del pedido original). El caso de un
    // payload realmente malformado ya quedó registrado más abajo si
    // corresponde.
    if (payload === null) {
      console.warn('WhatsApp webhook: payload no es JSON válido');
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;

        for (const message of value.messages ?? []) {
          // TODO (fase futura, fuera de este alcance): procesar el mensaje
          // entrante (guardarlo, interpretarlo, responder). Por ahora sólo
          // se deja registrada la recepción con IDs técnicos, sin contenido.
          console.log('Incoming WhatsApp message event', {
            messageId: message.id,
            type: message.type,
          });
        }

        for (const status of value.statuses ?? []) {
          // TODO (fase futura, fuera de este alcance): reflejar este estado
          // en `appointment_messages.status` (sent/delivered/read/failed),
          // matcheando por provider_message_id. Por ahora sólo se deja
          // registrado el evento.
          console.log(`WhatsApp status event: ${status.status}`, {
            messageId: status.id,
          });
        }
      }
    }
  } catch (err) {
    // Red de seguridad: un payload con forma inesperada nunca debe tirar
    // abajo el endpoint. Se registra sólo el mensaje de error, nunca el
    // payload completo.
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('WhatsApp webhook: error procesando el payload', message);
  }

  // Responder 200 rápido y siempre que el payload haya sido reconocido,
  // para evitar reintentos innecesarios de Meta.
  return NextResponse.json({ received: true }, { status: 200 });
}
