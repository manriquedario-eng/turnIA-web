// Cliente mínimo de WhatsApp Business Platform (Meta Cloud API), aislado del
// resto de la app. Nada fuera de este archivo debe conocer detalles HTTP de
// Meta: `agenda/actions.ts` sólo llama a `lib/whatsapp/send-appointment-created.ts`.
//
// Diseñado para funcionar en "modo seguro" cuando faltan credenciales: no
// intenta ninguna llamada de red y devuelve un resultado claro de
// "no configurado", en vez de romper el flujo que lo llama. Esto es
// intencional para 5E.2, donde puede no haber credenciales reales de Meta
// todavía.
//
// Variables de entorno esperadas (server-side únicamente, nunca expuestas al
// browser — no llevan prefijo NEXT_PUBLIC_):
//   WHATSAPP_ACCESS_TOKEN         token de acceso de la app de Meta
//   WHATSAPP_PHONE_NUMBER_ID      Phone Number ID de WhatsApp Cloud API
//   WHATSAPP_TEMPLATE_NAME        nombre de la plantilla aprobada por Meta
//   WHATSAPP_TEMPLATE_LANG        código de idioma de la plantilla (ej. "es_AR")
//   WHATSAPP_GRAPH_API_VERSION    opcional, default "v20.0"
//
// Ninguna de estas variables se hardcodea ni se versiona: se leen sólo desde
// process.env en tiempo de ejecución server-side.

export type WhatsAppTemplateComponent =
  | {
      type: 'body';
      parameters: { type: 'text'; text: string }[];
    }
  | {
      type: 'button';
      sub_type: 'quick_reply';
      index: string;
      parameters: [{ type: 'payload'; payload: string }];
    };

export type WhatsAppSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false, reason: 'not_configured' | 'invalid_phone' | 'provider_error' | 'network_error'; errorMessage: string };

function getBaseConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';

  if (!accessToken || !phoneNumberId) {
    return null;
  }

  return { accessToken, phoneNumberId, apiVersion };
}

/** true si hay credenciales + plantilla principal suficientes para enviar el mensaje inicial. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(getBaseConfig() && process.env.WHATSAPP_TEMPLATE_NAME);
}

/**
 * Envía un mensaje de plantilla (template) aprobada por Meta — nunca texto
 * libre arbitrario, tal como exige WhatsApp Cloud API para mensajes
 * iniciados por el negocio. `to` debe venir ya en formato E.164 sin el "+"
 * (Graph API lo espera como dígitos, ej. "5491122334455").
 */
export async function sendWhatsAppTemplate(params: {
  toE164: string;
  bodyParams: string[];
  quickReplyPayloads?: string[];
  templateName?: string;
  templateLang?: string;
}): Promise<WhatsAppSendResult> {
  const config = getBaseConfig();
  const templateName = params.templateName || process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLang = params.templateLang || process.env.WHATSAPP_TEMPLATE_LANG || 'es_AR';

  if (!config || !templateName) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Credenciales o plantilla de WhatsApp no configuradas.' };
  }

  const to = params.toE164.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(to)) {
    return { ok: false, reason: 'invalid_phone', errorMessage: 'Teléfono en formato E.164 inválido.' };
  }

  const components: WhatsAppTemplateComponent[] = [
    {
      type: 'body',
      parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
    },
  ];

  for (const [index, payload] of (params.quickReplyPayloads ?? []).entries()) {
    if (index > 2) break;
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload }],
    });
  }

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLang },
          components,
        },
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      // Sanitizado: sólo el mensaje de error de Meta, nunca el token ni el
      // payload completo de la request.
      const errorMessage = json?.error?.message || `Meta respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }

    const providerMessageId = json?.messages?.[0]?.id;
    if (!providerMessageId) {
      return { ok: false, reason: 'provider_error', errorMessage: 'Meta no devolvió un ID de mensaje.' };
    }

    return { ok: true, providerMessageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }
}


/**
 * Envía una respuesta de texto libre dentro de la ventana de atención abierta
 * por una interacción del paciente (por ejemplo, al tocar un botón de una
 * plantilla). No se usa para iniciar conversaciones.
 */
export async function sendWhatsAppTextMessage(params: {
  toWaId: string;
  text: string;
}): Promise<WhatsAppSendResult> {
  const config = getBaseConfig();

  if (!config) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Credenciales de WhatsApp no configuradas.' };
  }

  const to = params.toWaId.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(to)) {
    return { ok: false, reason: 'invalid_phone', errorMessage: 'Teléfono de WhatsApp inválido.' };
  }

  const text = params.text.trim();
  if (!text) {
    return { ok: false, reason: 'provider_error', errorMessage: 'Respuesta de WhatsApp vacía.' };
  }

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text.slice(0, 4096) },
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage = json?.error?.message || `Meta respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }

    const providerMessageId = json?.messages?.[0]?.id;
    if (!providerMessageId) {
      return { ok: false, reason: 'provider_error', errorMessage: 'Meta no devolvió un ID de mensaje.' };
    }

    return { ok: true, providerMessageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }
}
