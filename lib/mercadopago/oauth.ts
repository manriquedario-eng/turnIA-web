// Mercado Pago OAuth 2.0 (Authorization Code + PKCE) — conexión de la
// cuenta de Mercado Pago de CADA profesional (no una cuenta compartida de
// TurnIA). Aislado del resto de la app: nada fuera de lib/mercadopago/ debe
// conocer detalles del protocolo OAuth de Mercado Pago. Mismo criterio de
// separación que lib/google/oauth.ts.
//
// FASE 2: esto sólo conecta/desconecta la cuenta y la refleja en Settings.
// NO crea órdenes, NO cobra, NO toca webhooks ni ARCA — eso es una fase
// posterior y usará la conexión que este módulo guarda.
//
// Endpoints oficiales verificados contra la documentación vigente de
// Mercado Pago Developers (docs.mercadopago.com, sección Security > OAuth)
// al momento de escribir esto — no inventados:
//   Autorización: https://auth.mercadopago.com/authorization
//   Token:        https://api.mercadopago.com/oauth/token (POST)
// El endpoint de token devuelve, entre otros campos: access_token,
// refresh_token, expires_in, scope, token_type, user_id (el ID numérico de
// la cuenta de Mercado Pago conectada — se persiste como texto en
// mp_user_id).
//
// Scopes (read / write / offline_access): la documentación actual de
// Mercado Pago NO describe un parámetro `scope` soportado en la URL de
// autorización — a diferencia de Google, los scopes de una app de Mercado
// Pago se habilitan a nivel de la aplicación en el Developer Dashboard, no
// se piden por request. Igual se envía `scope=read write offline_access`
// en la URL de autorización como expresión explícita de intención (es
// inocuo si Mercado Pago lo ignora), pero el límite real de permisos que
// hay que garantizar es que la app en el Dashboard de Mercado Pago tenga
// habilitados ÚNICAMENTE esos tres scopes — eso queda fuera del alcance de
// este código y hay que verificarlo manualmente en el Dashboard.
//
// PKCE: soportado por Mercado Pago (code_challenge / code_challenge_method
// en la URL de autorización, code_verifier en el intercambio por token).
// Se usa siempre, S256.
//
// Variables de entorno esperadas (server-side únicamente, nunca
// NEXT_PUBLIC_):
//   MP_CLIENT_ID
//   MP_CLIENT_SECRET      nunca se loguea ni se expone
//   MP_REDIRECT_URI       debe coincidir EXACTO con el configurado en el
//                         Developer Dashboard de Mercado Pago
//   MP_TOKEN_ENCRYPTION_KEY  ver ./token-crypto.ts
//
// Además requiere SUPABASE_SERVICE_ROLE_KEY (ver lib/supabase/service.ts).
// Sin cualquiera de estas variables, toda función acá devuelve "no
// configurado" — nunca lanza, nunca hardcodea nada.
//
// Revocación remota: Mercado Pago NO expone (a la fecha de esta
// implementación) un endpoint de revocación programática de tokens OAuth.
// Su documentación de gestión de Access Token describe cómo un token deja
// de ser válido (expiración, cambio de contraseña, revocación manual del
// vendedor desde su cuenta de Mercado Pago, detección de fraude) y ofrece
// webhooks para ENTERARSE cuando un vendedor desautoriza la app — pero no
// un método que la app pueda invocar para forzar esa revocación. Por eso
// disconnectMercadoPagoOAuthConnection NUNCA intenta ni simula una
// revocación remota: hace únicamente limpieza local segura (ver más abajo)
// y lo documenta en vez de inventar un endpoint.

import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { encryptMercadoPagoToken, isMercadoPagoTokenEncryptionConfigured } from './token-crypto';

const MP_AUTH_ENDPOINT = 'https://auth.mercadopago.com/authorization';
const MP_TOKEN_ENDPOINT = 'https://api.mercadopago.com/oauth/token';

// Ver comentario de cabecera: expresión de intención, no una garantía —
// el límite real está en el Developer Dashboard de la app de Mercado Pago.
const MP_REQUESTED_SCOPES = 'read write offline_access';

// Versión del esquema de cifrado con el que se guardan los tokens de ESTA
// conexión — corresponde al envelope `enc:v1:...` de ./token-crypto.ts.
// mercadopago_connections.encryption_key_version ya tiene un default de 1
// en el schema; se fija acá explícitamente para que la persistencia no
// dependa silenciosamente de ese default si el esquema de cifrado cambia
// en el futuro.
const CURRENT_ENCRYPTION_KEY_VERSION = 1;

export type MercadoPagoOAuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' | 'provider_error' | 'network_error'; errorMessage: string };

function getOAuthConfig() {
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  const redirectUri = process.env.MP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isMercadoPagoOAuthConfigured(): boolean {
  return getOAuthConfig() !== null && isServiceRoleConfigured() && isMercadoPagoTokenEncryptionConfigured();
}

export type MercadoPagoPkcePair = {
  codeVerifier: string;
  codeChallenge: string;
};

/**
 * Genera el par PKCE (Authorization Code + PKCE, RFC 7636): un
 * code_verifier aleatorio de alta entropía y su code_challenge S256
 * (SHA-256, base64url sin padding). El caller (route handler de /connect)
 * es quien decide dónde guardar `codeVerifier` (cookie httpOnly separada,
 * nunca en el browser vía JS) — esta función es protocolo puro, sin IO.
 *
 * 64 bytes aleatorios en base64url producen un string de 86 caracteres,
 * dentro del rango 43-128 que exige RFC 7636, y el alfabeto base64url
 * (A-Z a-z 0-9 - _) es un subconjunto válido de los caracteres permitidos
 * para code_verifier.
 */
export function generateMercadoPagoPkcePair(): MercadoPagoPkcePair {
  const codeVerifier = randomBytes(64).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

/** URL a la que se redirige al profesional para autorizar TurnIA a acceder a su cuenta de Mercado Pago. */
export function buildMercadoPagoAuthUrl(state: string, codeChallenge: string): MercadoPagoOAuthResult<string> {
  const config = getOAuthConfig();
  if (!config) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Mercado Pago OAuth no está configurado.' };
  }

  const url = new URL(MP_AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', MP_REQUESTED_SCOPES);

  return { ok: true, data: url.toString() };
}

type MercadoPagoTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  user_id: number | string;
};

/**
 * Intercambia el `code` que Mercado Pago devuelve en el callback por
 * tokens (server-side únicamente, con el code_verifier PKCE
 * correspondiente), y los guarda (upsert) en mercadopago_connections para
 * (tenantId, userId). También refleja el estado en integration_status.
 * Nunca lanza: cualquier fallo se devuelve como resultado.
 */
export async function completeMercadoPagoOAuthConnection(params: {
  tenantId: string;
  userId: string;
  code: string;
  codeVerifier: string;
}): Promise<MercadoPagoOAuthResult<{ accountLabel: string }>> {
  const config = getOAuthConfig();
  if (!config || !isServiceRoleConfigured() || !isMercadoPagoTokenEncryptionConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Mercado Pago OAuth no está configurado.' };
  }

  let tokenJson: MercadoPagoTokenResponse;
  try {
    const response = await fetch(MP_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code_verifier: params.codeVerifier,
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.access_token || json?.user_id === undefined || json?.user_id === null) {
      // Sanitizado: nunca loguear el `code`, el `code_verifier` ni el body
      // completo de la request (contiene el client_secret).
      const errorMessage = json?.message || json?.error || `Mercado Pago respondió ${response.status}`;
      return { ok: false, reason: 'provider_error', errorMessage: String(errorMessage).slice(0, 500) };
    }
    tokenJson = json as MercadoPagoTokenResponse;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: errorMessage.slice(0, 500) };
  }

  // Cifrar ANTES de cualquier upsert — en ningún momento se guarda un
  // access_token/refresh_token en texto plano. Si el cifrado falla (clave
  // ausente/inválida, error interno), se aborta la conexión sin persistir
  // nada: nunca se cae a guardar plaintext como respaldo.
  const encryptedAccessToken = encryptMercadoPagoToken(tokenJson.access_token);
  if (!encryptedAccessToken.ok) {
    console.error('Mercado Pago OAuth: no se pudo cifrar el access_token antes de guardarlo — conexión abortada');
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo completar la conexión de forma segura. Probá de nuevo en unos minutos.',
    };
  }

  // El refresh_token es opcional en el schema (a diferencia de Google, acá
  // mercadopago_connections.refresh_token_ciphertext admite NULL) — si
  // Mercado Pago no lo devuelve, se persiste la conexión igual con
  // refresh_token_ciphertext = null en vez de abortar.
  let encryptedRefreshToken: string | null = null;
  if (tokenJson.refresh_token) {
    const encryptedRefreshResult = encryptMercadoPagoToken(tokenJson.refresh_token);
    if (!encryptedRefreshResult.ok) {
      console.error('Mercado Pago OAuth: no se pudo cifrar el refresh_token antes de guardarlo — conexión abortada');
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'No se pudo completar la conexión de forma segura. Probá de nuevo en unos minutos.',
      };
    }
    encryptedRefreshToken = encryptedRefreshResult.data;
  }

  const mpUserId = String(tokenJson.user_id);
  // Mercado Pago no entrega de forma simple un email/nombre de cuenta vía
  // este flujo de OAuth — no se hacen requests adicionales para
  // conseguirlo ni se inventa un dato: se usa un label seguro derivado del
  // mp_user_id, que no es sensible (es el identificador público de cuenta
  // que el propio profesional ve en su Mercado Pago).
  const accountLabel = `Mercado Pago · ${mpUserId}`;
  const tokenExpiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;
  const nowIso = new Date().toISOString();

  try {
    const serviceClient = createSupabaseServiceClient();

    const { error: connectionError } = await serviceClient
      .from('mercadopago_connections')
      .upsert(
        {
          tenant_id: params.tenantId,
          user_id: params.userId,
          mp_user_id: mpUserId,
          access_token_ciphertext: encryptedAccessToken.data,
          refresh_token_ciphertext: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          scope: tokenJson.scope ?? null,
          token_type: tokenJson.token_type ?? null,
          encryption_key_version: CURRENT_ENCRYPTION_KEY_VERSION,
          connected_at: nowIso,
          updated_at: nowIso,
          revoked_at: null,
        },
        { onConflict: 'tenant_id,user_id' }
      );

    if (connectionError) {
      console.error('Mercado Pago OAuth Supabase error:', {
        code: connectionError.code,
        message: connectionError.message,
        details: connectionError.details,
        hint: connectionError.hint,
      });
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'No se pudo guardar la conexión de Mercado Pago.',
      };
    }

    const { error: statusError } = await serviceClient.from('integration_status').upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        provider: 'mercadopago',
        status: 'connected',
        account_label: accountLabel,
        connected_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'tenant_id,user_id,provider' }
    );

    if (statusError) {
      console.error('Mercado Pago OAuth: fallo de Supabase al actualizar integration_status', {
        code: statusError.code,
        message: statusError.message,
      });
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'No se pudo guardar la conexión de Mercado Pago.',
      };
    }

    return { ok: true, data: { accountLabel } };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido al guardar la conexión';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }
}

/**
 * Desconecta a un profesional de Mercado Pago. A diferencia de
 * lib/google/oauth.ts, esto NUNCA intenta una revocación remota: Mercado
 * Pago no ofrece (ver comentario de cabecera del archivo) un endpoint
 * oficial de revocación programática aplicable a este flujo, así que no se
 * inventa uno ni se simula que hubo revocación remota.
 *
 * Lo que sí hace, siempre:
 *  - elimina la fila local de mercadopago_connections (DELETE, no soft
 *    delete) para que TurnIA deje de tener acceso a cualquier token de
 *    inmediato — no se conservan tokens "por si acaso";
 *  - pone integration_status en not_connected.
 *
 * Idempotente: si no existe conexión local, se considera igualmente
 * desconectado (un DELETE sin filas que matcheen no es un error).
 */
export async function disconnectMercadoPagoOAuthConnection(params: {
  tenantId: string;
  userId: string;
}): Promise<MercadoPagoOAuthResult<{ remoteRevocationAvailable: false }>> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Mercado Pago OAuth no está configurado.' };
  }

  const serviceClient = createSupabaseServiceClient();

  try {
    // TurnIA deja de usar la conexión de inmediato — DELETE de la fila (no
    // se conservan los tokens) y `integration_status` vuelve a
    // `not_connected`. Igual que en Google, Supabase no necesariamente
    // lanza ante un error SQL/API: puede devolver `{ error }` sin
    // excepción, así que ambas operaciones se inspeccionan explícitamente.
    // Un DELETE sin ninguna fila que matchee no es un error (idempotente).
    const { error: deleteError } = await serviceClient
      .from('mercadopago_connections')
      .delete()
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId);

    if (deleteError) {
      console.error('Mercado Pago OAuth: fallo de Supabase al eliminar la conexión local', {
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
          provider: 'mercadopago',
          status: 'not_connected',
          account_label: null,
          connected_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id,provider' }
      );

    if (statusError) {
      console.error('Mercado Pago OAuth: fallo de Supabase al actualizar integration_status tras desconectar', {
        code: statusError.code,
        message: statusError.message,
      });
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'No pudimos completar la desconexión. Probá de nuevo en unos minutos.',
      };
    }

    // `remoteRevocationAvailable: false` siempre — nunca se le hace creer
    // al caller que se intentó o confirmó una revocación del lado de
    // Mercado Pago (ver comentario de cabecera).
    return { ok: true, data: { remoteRevocationAvailable: false } };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido al desconectar';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 500) };
  }
}
