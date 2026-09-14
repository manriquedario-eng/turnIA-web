// Creación de eventos de Google Calendar con Google Meet, usando la cuenta
// de Google de CADA profesional (nunca una cuenta compartida). Aislado del
// resto de la app: `agenda/actions.ts` sólo llama a
// `createGoogleMeetForAppointment` y nunca ve tokens ni detalles HTTP de
// Google.
//
// Mismo principio que lib/whatsapp/provider.ts: esta función NUNCA lanza.
// Un fallo (no conectado, token vencido sin poder refrescar, error de
// Google, error de red) se traduce siempre en un resultado `ok: false`
// claro. El turno ya está creado en Supabase antes de llamar acá — un
// fallo de Google jamás debe hacer perder el turno.

import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export type CreateGoogleMeetResult =
  | { ok: true; eventId: string; meetUrl: string }
  | {
      ok: false;
      reason: 'not_configured' | 'not_connected' | 'provider_error' | 'network_error';
      errorMessage: string;
    };

type StoredConnection = {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
};

/**
 * Devuelve un access token válido para (tenantId, userId), refrescándolo
 * contra Google si venció, y persistiendo el nuevo token. Nunca lanza:
 * devuelve null si no hay conexión, está revocada, o el refresh falla.
 */
async function getValidAccessToken(
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  userId: string
): Promise<string | null> {
  const { data: connection, error } = await serviceClient
    .from('google_oauth_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle<StoredConnection>();

  if (error || !connection) return null;

  const expiresAt = new Date(connection.token_expires_at).getTime();
  const stillValid = expiresAt - Date.now() > 60_000; // margen de 1 minuto
  if (stillValid) return connection.access_token;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: connection.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.access_token) return null;

    const newExpiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
    await serviceClient
      .from('google_oauth_connections')
      .update({
        access_token: json.access_token,
        token_expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    return json.access_token as string;
  } catch {
    return null;
  }
}

/**
 * Crea el evento en el Google Calendar del profesional con conferenceData
 * (Google Meet). SIEMPRE llamar sólo cuando modality === 'online' — esta
 * función no vuelve a validar la modalidad, esa regla vive en
 * agenda/actions.ts, igual que el gate de consentimiento de WhatsApp vive
 * en send-appointment-created.ts.
 *
 * Minimiza datos enviados a Google: el `summary`/`description` que arma el
 * llamador NO debe incluir motivo de consulta, diagnóstico ni notas
 * clínicas — sólo nombre del paciente y del profesional (ver PARTE 12 del
 * pedido original).
 */
export async function createGoogleMeetForAppointment(params: {
  tenantId: string;
  professionalUserId: string;
  appointmentId: string;
  summary: string;
  startsAtIso: string;
  endsAtIso: string;
  timeZone: string;
}): Promise<CreateGoogleMeetResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Integración de Google no configurada (falta SUPABASE_SERVICE_ROLE_KEY).' };
  }

  let accessToken: string | null;
  try {
    const serviceClient = createSupabaseServiceClient();
    accessToken = await getValidAccessToken(serviceClient, params.tenantId, params.professionalUserId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }

  if (!accessToken) {
    return { ok: false, reason: 'not_connected', errorMessage: 'El profesional no tiene Google Calendar conectado.' };
  }

  try {
    const response = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?conferenceDataVersion=1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.summary,
        start: { dateTime: params.startsAtIso, timeZone: params.timeZone },
        end: { dateTime: params.endsAtIso, timeZone: params.timeZone },
        // requestId único por turno: garantiza un Meet único por evento,
        // incluso ante un reintento accidental de esta misma llamada.
        conferenceData: {
          createRequest: {
            requestId: `turnia-${params.appointmentId}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage = json?.error?.message || `Google respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }

    const eventId: string | undefined = json?.id;
    const meetUrl: string | undefined =
      json?.hangoutLink ||
      json?.conferenceData?.entryPoints?.find((entryPoint: { entryPointType?: string; uri?: string }) => entryPoint.entryPointType === 'video')?.uri;

    if (!eventId || !meetUrl) {
      return { ok: false, reason: 'provider_error', errorMessage: 'Google no devolvió un enlace de Meet.' };
    }

    return { ok: true, eventId, meetUrl };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }
}

// ---------------------------------------------------------------------------
// Preparado para fases futuras (PARTE 4 del pedido: no implementar todavía,
// pero no diseñar de forma que lo impida). No están conectadas a
// updateAppointment/cancelAppointment en esta tarea.
// ---------------------------------------------------------------------------

export type UpdateGoogleMeetResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'not_connected' | 'provider_error' | 'network_error'; errorMessage: string };

/** TODO (fase futura): llamar desde updateAppointment cuando cambie fecha/hora de un turno online. */
export async function updateGoogleMeetForAppointment(params: {
  tenantId: string;
  professionalUserId: string;
  externalCalendarEventId: string;
  startsAtIso: string;
  endsAtIso: string;
  timeZone: string;
}): Promise<UpdateGoogleMeetResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Integración de Google no configurada.' };
  }

  let accessToken: string | null;
  try {
    const serviceClient = createSupabaseServiceClient();
    accessToken = await getValidAccessToken(serviceClient, params.tenantId, params.professionalUserId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }
  if (!accessToken) {
    return { ok: false, reason: 'not_connected', errorMessage: 'El profesional no tiene Google Calendar conectado.' };
  }

  try {
    const response = await fetch(`${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(params.externalCalendarEventId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { dateTime: params.startsAtIso, timeZone: params.timeZone },
        end: { dateTime: params.endsAtIso, timeZone: params.timeZone },
      }),
    });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      const errorMessage = json?.error?.message || `Google respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }
}

/** TODO (fase futura): llamar desde cancelAppointment cuando se cancele un turno online. */
export async function cancelGoogleMeetForAppointment(params: {
  tenantId: string;
  professionalUserId: string;
  externalCalendarEventId: string;
}): Promise<UpdateGoogleMeetResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Integración de Google no configurada.' };
  }

  let accessToken: string | null;
  try {
    const serviceClient = createSupabaseServiceClient();
    accessToken = await getValidAccessToken(serviceClient, params.tenantId, params.professionalUserId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }
  if (!accessToken) {
    return { ok: false, reason: 'not_connected', errorMessage: 'El profesional no tiene Google Calendar conectado.' };
  }

  try {
    const response = await fetch(`${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(params.externalCalendarEventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const json = await response.json().catch(() => null);
      const errorMessage = json?.error?.message || `Google respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }
}
