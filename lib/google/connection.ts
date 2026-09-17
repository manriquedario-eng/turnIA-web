// Lectura centralizada de una conexión de Google OAuth
// (google_oauth_connections), con descifrado y migración transparente de la
// única conexión legacy que puede tener tokens en texto plano (anteriores a
// este hardening). NI lib/google/oauth.ts NI lib/google/calendar.ts deben
// volver a leer/descifrar tokens por su cuenta — todo pasa por acá, para no
// duplicar la lógica de legacy/descifrado en dos lugares que puedan
// divergir.
//
// server-only: maneja tokens descifrados en memoria.

import 'server-only';
import type { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isServiceRoleConfigured } from '@/lib/supabase/service';
import {
  decryptGoogleToken,
  encryptGoogleToken,
  isEncryptedGoogleToken,
  isGoogleTokenEncryptionConfigured,
} from './token-crypto';

export type UsableGoogleConnection = {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
};

export type GetUsableConnectionResult =
  | { ok: true; connection: UsableGoogleConnection }
  | { ok: false; reason: 'not_configured' | 'not_connected' | 'decryption_failed' | 'migration_failed' };

type StoredConnectionRow = {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
};

/**
 * Busca la conexión activa (no revocada) de (tenantId, userId), la descifra,
 * y si encuentra tokens legacy en texto plano los cifra y persiste de
 * inmediato antes de devolverlos utilizables.
 *
 * Casos:
 *  - access_token y refresh_token ya `enc:v1:...`: se descifran en memoria y
 *    se devuelven.
 *  - ambos son legacy (texto plano, sin el prefijo): se cifran los DOS
 *    juntos y se actualiza la fila en una sola operación; sólo si ese UPDATE
 *    tiene éxito se considera la conexión utilizable (con los valores
 *    plaintext que ya se tenían en memoria de la lectura original — no hace
 *    falta releer después de escribir).
 *  - uno cifrado y el otro no (estado inconsistente/corrupto): nunca se
 *    intenta adivinar cuál es cuál — se trata como no utilizable.
 *  - si el UPDATE de migración falla: no se continúa usando el token.
 *
 * Nunca loguea plaintext, ciphertext, ni tokens parciales.
 */
export async function getUsableGoogleConnection(
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  userId: string
): Promise<GetUsableConnectionResult> {
  if (!isServiceRoleConfigured() || !isGoogleTokenEncryptionConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  const { data: row, error } = await serviceClient
    .from('google_oauth_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle<StoredConnectionRow>();

  if (error) {
    console.error('google-connection: fallo de Supabase al leer la conexión', {
      code: error.code,
      message: error.message,
    });
    return { ok: false, reason: 'not_connected' };
  }
  if (!row) return { ok: false, reason: 'not_connected' };

  const accessIsEncrypted = isEncryptedGoogleToken(row.access_token);
  const refreshIsEncrypted = isEncryptedGoogleToken(row.refresh_token);

  if (accessIsEncrypted && refreshIsEncrypted) {
    const accessResult = decryptGoogleToken(row.access_token);
    const refreshResult = decryptGoogleToken(row.refresh_token);
    if (!accessResult.ok || !refreshResult.ok) {
      console.error('google-connection: fallo al descifrar la conexión (formato/tag inválido)');
      return { ok: false, reason: 'decryption_failed' };
    }
    return {
      ok: true,
      connection: {
        accessToken: accessResult.data,
        refreshToken: refreshResult.data,
        tokenExpiresAt: row.token_expires_at,
      },
    };
  }

  if (!accessIsEncrypted && !refreshIsEncrypted) {
    // Legacy plaintext: cifrar AMBOS ahora mismo y actualizar las dos
    // columnas en una sola operación antes de considerar la conexión
    // utilizable.
    const encryptedAccess = encryptGoogleToken(row.access_token);
    const encryptedRefresh = encryptGoogleToken(row.refresh_token);
    if (!encryptedAccess.ok || !encryptedRefresh.ok) {
      console.error('google-connection: no se pudo cifrar la conexión legacy para migrarla');
      return { ok: false, reason: 'migration_failed' };
    }

    // `.select('id').maybeSingle()` para comprobar que el UPDATE realmente
    // afectó una fila — nunca alcanza con la ausencia de error, porque un
    // WHERE que no matchea ninguna fila (por ejemplo, si una desconexión
    // concurrente ya la revocó/eliminó entre el SELECT de arriba y este
    // UPDATE) tampoco es un error para Supabase. `.is('revoked_at', null)`
    // repite la misma condición de la lectura original, para no migrar (ni
    // usar) una conexión que dejó de estar activa en el medio.
    const { data: migratedRow, error: migrationError } = await serviceClient
      .from('google_oauth_connections')
      .update({
        access_token: encryptedAccess.data,
        refresh_token: encryptedRefresh.data,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (migrationError) {
      console.error('google-connection: fallo de Supabase al migrar la conexión legacy a cifrado', {
        code: migrationError.code,
        message: migrationError.message,
      });
      return { ok: false, reason: 'migration_failed' };
    }

    if (!migratedRow) {
      // Ninguna fila matcheó el UPDATE — la conexión dejó de estar activa
      // en la ventana entre el SELECT y este UPDATE (por ejemplo, una
      // desconexión concurrente). Nunca devolver los tokens plaintext que
      // ya se tenían en memoria en ese caso.
      return { ok: false, reason: 'not_connected' };
    }

    return {
      ok: true,
      connection: {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        tokenExpiresAt: row.token_expires_at,
      },
    };
  }

  // Uno cifrado y el otro no: estado inconsistente. Nunca adivinar cuál es
  // legacy — no se usa la conexión.
  console.error('google-connection: estado inconsistente — un token está cifrado y el otro no');
  return { ok: false, reason: 'decryption_failed' };
}

/**
 * Cifra un access_token recién refrescado por Google y lo persiste. Nunca
 * vuelve a guardar un access_token en texto plano: si el cifrado falla, si
 * Supabase devuelve error, o si el UPDATE no afectó ninguna fila activa
 * (`.is('revoked_at', null)` — por ejemplo, una desconexión concurrente),
 * no se considera persistido: se devuelve `false` y el llamador debe
 * fail-closed (no seguir usando ese access_token), nunca asumir éxito.
 */
export async function persistRefreshedAccessToken(
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  userId: string,
  newAccessToken: string,
  newTokenExpiresAtIso: string
): Promise<boolean> {
  const encrypted = encryptGoogleToken(newAccessToken);
  if (!encrypted.ok) {
    console.error('google-connection: no se pudo cifrar el access_token refrescado, no se persiste');
    return false;
  }

  const { data: updatedRow, error } = await serviceClient
    .from('google_oauth_connections')
    .update({
      access_token: encrypted.data,
      token_expires_at: newTokenExpiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('google-connection: fallo de Supabase al persistir el access_token refrescado', {
      code: error.code,
      message: error.message,
    });
    return false;
  }

  if (!updatedRow) {
    console.error('google-connection: el access_token refrescado no se persistió — ninguna fila activa matcheó el UPDATE');
    return false;
  }

  return true;
}
