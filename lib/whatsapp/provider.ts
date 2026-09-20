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

export type WhatsAppTemplateComponent = {
  type: 'body';
  parameters: { type: 'text'; text: string }[];
};

export type WhatsAppSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false, reason: 'not_configured' | 'invalid_phone' | 'provider_error' | 'network_error'; errorMessage: string };

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || 'es_AR';
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';

  if (!accessToken || !phoneNumberId || !templateName) {
    return null;
  }
  return { accessToken, phoneNumberId, templateName, templateLang, apiVersion };
}

/** true si hay credenciales suficientes para intentar un envío real. */
export function isWhatsAppConfigured(): boolean {
  return getConfig() !== null;
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
}): Promise<WhatsAppSendResult> {
  const config = getConfig();
  if (!config) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Credenciales de WhatsApp no configuradas.' };
  }

  const to = params.toE164.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(to)) {
    return { ok: false, reason: 'invalid_phone', errorMessage: 'Teléfono en formato E.164 inválido.' };
  }

  const component: WhatsAppTemplateComponent = {
    type: 'body',
    parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
  };

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
          name: config.templateName,
          language: { code: config.templateLang },
          components: [component],
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
