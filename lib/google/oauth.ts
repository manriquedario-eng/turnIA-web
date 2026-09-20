// Google OAuth 2.0 — conexión de la cuenta de Google de CADA profesional
// (no una cuenta compartida de TurnIA). Aislado del resto de la app: nada
// fuera de lib/google/ debe conocer detalles del protocolo OAuth de Google.
//
// Alcance del scope pedido: sólo lo necesario para crear/leer eventos de
// Google Calendar y generar Google Meet. NO se pide Gmail, Drive ni nada
// más amplio.
//
// Variables de entorno esperadas (server-side únicamente, nunca
// NEXT_PUBLIC_):
//   GOOGLE_CLIENT_ID       Client ID de la app en Google Cloud Console
//   GOOGLE_CLIENT_SECRET   Client Secret — nunca se loguea ni se expone
//   GOOGLE_REDIRECT_URI    redirect alternativo para desarrollo/staging.
//                          En producción TurnIA usa siempre:
//                          https://www.turniahealth.com.ar/api/google/oauth/callback
//
// Además requiere SUPABASE_SERVICE_ROLE_KEY (ver lib/supabase/service.ts)
// para poder guardar los tokens. Sin cualquiera de estas variables, toda
// función acá devuelve "no configurado" — nunca lanza, nunca hardcodea
// nada.

import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { encryptGoogleToken, isGoogleTokenEncryptionConfigured } from './token-crypto';
import { getUsableGoogleConnection } from './connection';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const TURNIA_GOOGLE_REDIRECT_URI = 'https://www.turniahealth.com.ar/api/google/oauth/callback';

// Scope mínimo: sólo eventos de Calendar (crear/editar/borrar EL evento que
// TurnIA crea) + identificar la cuenta conectada (email) para mostrarla en
// Settings. No se pide acceso de lectura a todo el calendario del
// profesional.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ');

export type GoogleOAuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' | 'provider_error' | 'network_error'; errorMessage: string };

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.VERCEL_ENV === 'production'
      ? TURNIA_GOOGLE_REDIRECT_URI
      : process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleOAuthConfigured(): boolean {
  return getOAuthConfig() !== null && isServiceRoleConfigured() && isGoogleTokenEncryptionConfigured();
}

/** URL a la que se redirige al profesional para autorizar TurnIA. */
export function buildGoogleAuthUrl(state: string): GoogleOAuthResult<string> {
  const config = getOAuthConfig();
  if (!config) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Google OAuth no está configurado.' };
  }

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('access_type', 'offline'); // necesario para recibir refresh_token
  url.searchParams.set('prompt', 'consent'); // fuerza refresh_token también en re-conexiones
  url.searchParams.set('state', state);

  return { ok: true, data: url.toString() };
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as { email?: string } | null;
    return json?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Intercambia el `code` que Google devuelve en el callback por tokens, y los
 * guarda (upsert) en google_oauth_connections para (tenantId, userId).
 * También refleja el estado en integration_status. Nunca lanza: cualquier
 * fallo se devuelve como resultado.
 */
export async function completeGoogleOAuthConnection(params: {
  tenantId: string;
  userId: string;
  code: string;
}): Promise<GoogleOAuthResult<{ googleAccountEmail: string | null }>> {
  const config = getOAuthConfig();
  if (!config || !isServiceRoleConfigured() || !isGoogleTokenEncryptionConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Google OAuth no está configurado.' };
  }

  let tokenJson: GoogleTokenResponse;
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.access_token) {
      // Sanitizado: nunca loguear el `code` ni el body completo de la
      // request (contiene el client_secret).
      const errorMessage = json?.error_description || json?.error || `Google respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }
    tokenJson = json as GoogleTokenResponse;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }

  if (!tokenJson.refresh_token) {
    // Pasa cuando el profesional ya había autorizado antes y Google no
    // reemite el refresh_token. Con prompt=consent esto no debería pasar en
    // la primera conexión, pero si pasa no hay nada persistible de forma
    // segura: mejor fallar explícito que guardar una conexión inservible.
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'Google no devolvió un refresh token. Revocá el acceso de TurnIA en tu cuenta de Google e intentá conectar de nuevo.',
    };
  }

  const googleAccountEmail = await fetchGoogleAccountEmail(tokenJson.access_token);
  const tokenExpiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();

  // Cifrar ANTES de cualquier upsert — en ningún momento se guarda un
  // access_token/refresh_token en texto plano. Si el cifrado falla (clave
  // ausente/inválida, error interno), se aborta la conexión sin persistir
  // nada: nunca se cae a guardar plaintext como respaldo.
  const encryptedAccessToken = encryptGoogleToken(tokenJson.access_token);
  const encryptedRefreshToken = encryptGoogleToken(tokenJson.refresh_token);
  if (!encryptedAccessToken.ok || !encryptedRefreshToken.ok) {
    console.error('Google OAuth: no se pudo cifrar el token antes de guardarlo — conexión abortada');
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo completar la conexión de forma segura. Probá de nuevo en unos minutos.',
    };
  }

  try {
    const serviceClient = createSupabaseServiceClient();

    const { error: connectionError } = await serviceClient
      .from('google_oauth_connections')
      .upsert(
        {
          tenant_id: params.tenantId,
          user_id: params.userId,
          google_account_email: googleAccountEmail,
          access_token: encryptedAccessToken.data,
          refresh_token: encryptedRefreshToken.data,
          token_expires_at: tokenExpiresAt,
          scope: tokenJson.scope,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'tenant_id,user_id' }
      );

    if (connectionError) {
  console.error('Google OAuth Supabase error:', {
    code: connectionError.code,
    message: connectionError.message,
    details: connectionError.details,
    hint: connectionError.hint,
  });

  return {
    ok: false,
    reason: 'provider_error',
    errorMessage: 'No se pudo guardar la conexión de Google.',
  };
}

    await serviceClient.from('integration_status').upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        provider: 'google_calendar',
        status: 'connected',
        account_label: googleAccountEmail,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,user_id,provider' }
    );

    return { ok: true, data: { googleAccountEmail } };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido al guardar la conexión';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }
}

/**
 * Intenta revocar `token` (preferentemente el refresh_token, porque
 * representa la autorización persistente) contra el endpoint oficial de
 * revocación OAuth de Google. Nunca lanza. Devuelve `true` únicamente si
 * Google confirmó la revocación (2xx) — cualquier otra respuesta, o un
 * error de red, se trata como "no confirmado", nunca como excepción.
 * Nunca loguea el token.
 */
async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok) {
      console.warn('Google OAuth: revocación remota no confirmada', { status: response.status });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Google OAuth: error de red al revocar en Google', err instanceof Error ? err.message : 'desconocido');
    return false;
  }
}

/**
 * Desconecta a un profesional: intenta revocar la autorización del lado de
 * Google y, independientemente de esa respuesta, elimina la fila local de
 * `google_oauth_connections` (nunca se conservan los tokens "por si acaso"
 * después de desconectar). Idempotente: si no existe conexión local, se
 * considera igualmente desconectado.
 *
 * `googleRevocationConfirmed` en el resultado exitoso indica si Google
 * confirmó la revocación — el llamador NO debe decir "Google revocado
 * correctamente" cuando esto es `false`.
 */
export async function disconnectGoogleOAuthConnection(params: {
  tenantId: string;
  userId: string;
}): Promise<GoogleOAuthResult<{ googleRevocationConfirmed: boolean }>> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Google OAuth no está configurado.' };
  }

  const serviceClient = createSupabaseServiceClient();

  // A + B: cargar la conexión exacta y descifrar/migrar vía el helper
  // centralizado. C: si resultó un token utilizable, intentar revocarlo en
  // Google. Si no hay conexión, o está en un estado no descifrable/legacy
  // corrupto, simplemente no hay nada que revocar remotamente — nunca por
  // eso se bloquea la limpieza local de abajo.
  let googleRevocationConfirmed = false;
  try {
    const usable = await getUsableGoogleConnection(serviceClient, params.tenantId, params.userId);
    if (usable.ok) {
      googleRevocationConfirmed = await revokeGoogleToken(usable.connection.refreshToken);
    }
  } catch (err) {
    console.error('Google OAuth: error inesperado al intentar revocar en Google', err instanceof Error ? err.message : 'desconocido');
  }

  try {
    // D + E: TurnIA deja de usar la conexión pase lo que pase con Google —
    // DELETE de la fila (no se conservan los tokens) y `integration_status`
    // vuelve a `not_connected`. Supabase NO necesariamente lanza ante un
    // error SQL/API: puede devolver `{ error }` sin excepción, así que
    // ambas operaciones se inspeccionan explícitamente — `ok: true` sólo
    // puede ocurrir si la limpieza local realmente tuvo éxito. Un DELETE
    // sin ninguna fila que matchee no es un error (idempotente).
    //
    // Importante: si la revocación remota de arriba sí ocurrió pero esta
    // limpieza local falla, esa revocación en Google ya pasó — no hay (ni
    // se inventa) un rollback de eso. Sólo se reporta el fallo local.
    const { error: deleteError } = await serviceClient
      .from('google_oauth_connections')
      .delete()
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId);

    if (deleteError) {
      console.error('Google OAuth: fallo de Supabase al eliminar la conexión local', {
        code: deleteError.code,
        message: deleteError.message,
      });
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'No pudimos completar la desconexión. Probá de nuevo en unos minutos.',
      };
    }

    const { error: statusError } = await serviceClient
      .from('integration_status')
      .upsert(
        {
          tenant_id: params.tenantId,
          user_id: params.userId,
          provider: 'google_calendar',
          status: 'not_connected',
          account_label: null,
          connected_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id,provider' }
      );

    if (statusError) {
      console.error('Google OAuth: fallo de Supabase al actualizar integration_status tras desconectar', {
        code: statusError.code,
        message: statusError.message,
      });
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'No pudimos completar la desconexión. Probá de nuevo en unos minutos.',
      };
    }

    return { ok: true, data: { googleRevocationConfirmed } };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido al desconectar';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }
}
