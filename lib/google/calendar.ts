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
import { getUsableGoogleConnection, persistRefreshedAccessToken } from './connection';

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REQUEST_TIMEOUT_MS = 12_000;

export type CreateGoogleMeetResult =
  | { ok: true; eventId: string; meetUrl: string }
  | {
      ok: false;
      reason: 'not_configured' | 'not_connected' | 'provider_error' | 'network_error';
      errorMessage: string;
    };

/**
 * Devuelve un access token válido para (tenantId, userId), refrescándolo
 * contra Google si venció, y persistiendo el nuevo token (siempre cifrado —
 * ver lib/google/connection.ts). Nunca lanza: devuelve null si no hay
 * conexión, está revocada, no se pudo descifrar/migrar, o el refresh falla.
 *
 * Este archivo ya NO lee ni descifra tokens directamente de
 * `google_oauth_connections`: toda esa lógica (incluida la migración
 * transparente de la única conexión legacy en texto plano) vive en
 * `getUsableGoogleConnection`, compartida con lib/google/oauth.ts, para no
 * duplicarla en dos lugares que puedan divergir.
 */
async function getValidAccessToken(
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  userId: string
): Promise<string | null> {
  const usable = await getUsableGoogleConnection(serviceClient, tenantId, userId);
  if (!usable.ok) return null;

  const { accessToken, refreshToken, tokenExpiresAt } = usable.connection;

  const expiresAt = new Date(tokenExpiresAt).getTime();
  const stillValid = expiresAt - Date.now() > 60_000; // margen de 1 minuto
  if (stillValid) return accessToken;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.access_token) return null;

    const newExpiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
    // Cifrado antes de persistir — nunca se vuelve a guardar un
    // access_token plano. Fail-closed: si la persistencia cifrada no se
    // pudo confirmar (error de Supabase, o ninguna fila activa matcheó —
    // ver persistRefreshedAccessToken), NO se usa igual el token recién
    // obtenido. Preferimos que esta operación falle a dejar un
    // access_token válido circulando sin haber quedado guardado cifrado.
    const persisted = await persistRefreshedAccessToken(serviceClient, tenantId, userId, json.access_token, newExpiresAt);
    if (!persisted) {
      console.error('google-calendar: el access_token refrescado no se pudo persistir cifrado — no se usa');
      return null;
    }

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
  patientEmail?: string | null;
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
    const sendUpdates = params.patientEmail?.trim() ? '&sendUpdates=all' : '';
    const response = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?conferenceDataVersion=1${sendUpdates}`, {
      method: 'POST',
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.summary,
        start: { dateTime: params.startsAtIso, timeZone: params.timeZone },
        end: { dateTime: params.endsAtIso, timeZone: params.timeZone },
        ...(params.patientEmail?.trim()
          ? { attendees: [{ email: params.patientEmail.trim() }] }
          : {}),
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
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
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
