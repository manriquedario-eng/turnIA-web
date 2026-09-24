// Cliente mínimo de email transaccional CENTRAL de TurnIA, aislado del
// resto de la app — mismo patrón que lib/whatsapp/provider.ts. Nada fuera
// de este archivo debe conocer el proveedor HTTP concreto:
// `lib/email/send-appointment-created.ts` sólo llama a `sendTransactionalEmail`.
//
// Decisión de PARTE 5 del pedido (fase anterior): correo transaccional
// CENTRAL de TurnIA (una sola cuenta/API key por plataforma), no Gmail por
// profesional. Cada profesional NO necesita conectar nada para que salga el
// email.
//
// ESTA PASADA conecta el proveedor real: Resend (https://resend.com), vía
// fetch nativo — sin agregar el SDK de Resend como dependencia nueva, no
// hace falta para una llamada HTTP tan simple. Mientras no estén las
// variables de entorno configuradas, el envío queda en "modo seguro" (no
// intenta ninguna llamada de red) exactamente igual que WhatsApp cuando
// faltan credenciales de Meta — nunca rompe la creación del turno.
//
// Variables de entorno esperadas (server-side únicamente, nunca
// NEXT_PUBLIC_ — nunca hardcodeadas ni versionadas):
//   RESEND_API_KEY   API key de Resend (empieza con "re_").
//   EMAIL_FROM       remitente verificado en Resend. Acepta cualquiera de
//                    los dos formatos que soporta la API de Resend:
//                    "no-responder@tudominio.com" o
//                    "TurnIA <no-responder@tudominio.com>".
//
// Compatibilidad: si en vez de esas dos existen las variables que se habían
// documentado en la fase anterior (EMAIL_API_KEY / EMAIL_FROM_ADDRESS /
// EMAIL_FROM_NAME), también se aceptan como respaldo — así no se rompe
// nada si Dario ya las cargó en Vercel con esos nombres. RESEND_API_KEY /
// EMAIL_FROM son las que se documentan y las que hay que usar de acá en
// adelante.

const EMAIL_REQUEST_TIMEOUT_MS = 10_000;

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: 'not_configured' | 'invalid_recipient' | 'provider_error' | 'network_error'; errorMessage: string };

function getConfig() {
  const apiKey = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
  // EMAIL_FROM puede venir ya con formato "Nombre <email>" — si no, se arma
  // con EMAIL_FROM_NAME (fallback legado) + EMAIL_FROM_ADDRESS.
  const from = process.env.EMAIL_FROM
    || (process.env.EMAIL_FROM_ADDRESS
      ? `${process.env.EMAIL_FROM_NAME || 'TurnIA'} <${process.env.EMAIL_FROM_ADDRESS}>`
      : undefined);

  if (!apiKey || !from) {
    return null;
  }
  return { apiKey, from };
}

/** true si hay credenciales suficientes para intentar un envío real. */
export function isEmailConfigured(): boolean {
  return getConfig() !== null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string | null | undefined): value is string {
  return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}

/**
 * Envía un email transaccional desde la cuenta central de TurnIA, vía la
 * API HTTP de Resend (POST https://api.resend.com/emails). `to` debe
 * validarse con `isPlausibleEmail` ANTES de llamar acá (esta función no
 * vuelve a decidir si vale la pena intentar, sólo valida formato mínimo).
 *
 * IMPORTANTE (PARTE 12 del pedido): el `subject`/`html`/`text` que arma el
 * llamador (lib/email/send-appointment-created.ts) nunca debe incluir
 * motivo de consulta, diagnóstico ni notas clínicas.
 *
 * Esta función NUNCA lanza — cualquier fallo (red, proveedor, credenciales)
 * se traduce en un `SendEmailResult` con `ok:false`, para que el llamador lo
 * registre sin que un error acá pueda afectar la creación del turno.
 */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendEmailResult> {
  const config = getConfig();
  if (!config) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Proveedor de email no configurado (falta RESEND_API_KEY y/o EMAIL_FROM).' };
  }

  if (!isPlausibleEmail(params.to)) {
    return { ok: false, reason: 'invalid_recipient', errorMessage: 'Email de destino inválido.' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (!response.ok) {
      // No se vuelca el body crudo del proveedor al log de la app (podría
      // incluir el email del destinatario) — sólo status + un mensaje corto.
      let errorMessage = `Resend respondió ${response.status}`;
      try {
        const body = await response.json();
        if (body?.message) errorMessage = `Resend: ${body.message}`;
      } catch {
        // body no era JSON — se deja el mensaje genérico de arriba.
      }
      return { ok: false, reason: 'provider_error', errorMessage };
    }

    const body = await response.json().catch(() => null);
    const providerMessageId = typeof body?.id === 'string' ? body.id : 'unknown';
    return { ok: true, providerMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de red desconocido enviando email';
    return { ok: false, reason: 'network_error', errorMessage: message };
  }
}
