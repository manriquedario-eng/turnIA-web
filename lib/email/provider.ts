// Cliente mínimo de email transaccional CENTRAL de TurnIA, aislado del
// resto de la app — mismo patrón que lib/whatsapp/provider.ts. Nada fuera
// de este archivo debe conocer el proveedor HTTP concreto:
// `lib/email/send-appointment-created.ts` sólo llama a `sendTransactionalEmail`.
//
// Decisión de PARTE 5 del pedido: correo transaccional CENTRAL de TurnIA
// (una sola cuenta/API key por plataforma), no Gmail por profesional. Cada
// profesional NO necesita conectar nada para que salga el email.
//
// Este repo todavía no tenía ningún proveedor de email — se revisó
// package.json y no hay ninguna dependencia de email instalada. Por eso
// esta capa queda como ABSTRACCIÓN sin proveedor real conectado todavía:
// en "modo seguro" (sin credenciales) no intenta ninguna llamada de red y
// devuelve "no configurado", exactamente igual que WhatsApp cuando faltan
// credenciales de Meta.
//
// Para conectar un proveedor real (ej. Resend, Postmark) en el futuro: NO
// hace falta cambiar `lib/email/send-appointment-created.ts` ni
// `agenda/actions.ts` — sólo implementar el fetch real acá adentro, sin
// tocar el resto de la app. No se agregó ningún SDK/dependencia nueva a
// package.json en esta tarea (se usa fetch nativo), a propósito, para no
// atar el proyecto a un proveedor sin que Dario lo decida primero.
//
// Variables de entorno esperadas (server-side únicamente, nunca
// NEXT_PUBLIC_) — documentadas para cuando se elija proveedor real:
//   EMAIL_PROVIDER        ej. "resend" | "postmark" (hoy no usada: sin
//                          provider implementado, cualquier valor es
//                          ignorado y el envío queda en modo seguro)
//   EMAIL_API_KEY          API key del proveedor elegido
//   EMAIL_FROM_ADDRESS     remitente verificado, ej. "no-responder@turnia.app"
//   EMAIL_FROM_NAME        nombre visible del remitente, ej. "TurnIA"
//
// Ninguna de estas variables se hardcodea ni se versiona.

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: 'not_configured' | 'invalid_recipient' | 'provider_error' | 'network_error'; errorMessage: string };

function getConfig() {
  const apiKey = process.env.EMAIL_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME || 'TurnIA';

  if (!apiKey || !fromAddress) {
    return null;
  }
  return { apiKey, fromAddress, fromName };
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
 * Envía un email transaccional desde la cuenta central de TurnIA. `to` debe
 * validarse con `isPlausibleEmail` ANTES de llamar acá (esta función no
 * vuelve a decidir si vale la pena intentar, sólo valida formato mínimo).
 *
 * IMPORTANTE (PARTE 12 del pedido): el `subject`/`html`/`text` que arma el
 * llamador (lib/email/send-appointment-created.ts) nunca debe incluir
 * motivo de consulta, diagnóstico ni notas clínicas.
 */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendEmailResult> {
  const config = getConfig();
  if (!config) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Proveedor de email no configurado.' };
  }

  if (!isPlausibleEmail(params.to)) {
    return { ok: false, reason: 'invalid_recipient', errorMessage: 'Email de destino inválido.' };
  }

  // NOTA DE IMPLEMENTACIÓN: no hay proveedor real conectado todavía (ver
  // encabezado del archivo). Este bloque queda listo para reemplazar por la
  // llamada HTTP real al proveedor elegido (ej. POST a api.resend.com)
  // usando `config.apiKey`/`config.fromAddress`/`config.fromName`, sin
  // tocar la firma de `sendTransactionalEmail` ni a sus llamadores.
  return {
    ok: false,
    reason: 'not_configured',
    errorMessage: 'EMAIL_API_KEY está configurada pero todavía no hay una integración de proveedor real implementada en lib/email/provider.ts.',
  };
}
