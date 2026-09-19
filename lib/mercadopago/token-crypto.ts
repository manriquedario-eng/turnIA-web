// Cifrado en reposo de los tokens OAuth de Mercado Pago (access_token/
// refresh_token en mercadopago_connections). AES-256-GCM con APIs estándar
// de Node (`node:crypto`) — mismo diseño que lib/google/token-crypto.ts,
// pero con su PROPIA clave: MP_TOKEN_ENCRYPTION_KEY nunca se comparte ni se
// deriva de GOOGLE_TOKEN_ENCRYPTION_KEY ni de ningún otro secreto.
//
// server-only: este módulo nunca debe poder terminar en el bundle del
// browser (maneja la clave de cifrado de los tokens más sensibles de la
// integración de cobros).
//
// Variable de entorno requerida (server-side únicamente, nunca
// NEXT_PUBLIC_): MP_TOKEN_ENCRYPTION_KEY — base64 de exactamente 32 bytes
// aleatorios. Generarla, por ejemplo:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Formato persistido, versionado (permite rotar el esquema a futuro sin
// romper filas viejas) — idéntico al de Google:
//   enc:v1:<iv-base64url>:<tag-base64url>:<ciphertext-base64url>
// IV (12 bytes, nuevo y aleatorio en CADA cifrado) y el authentication tag
// de GCM (16 bytes) viajan junto al ciphertext porque no son secretos —
// sólo la clave lo es.
//
// El descifrado SIEMPRE autentica vía GCM (`setAuthTag` + `decipher.final()`
// lanza si el tag no matchea): si el ciphertext o el tag fueron alterados,
// esto falla cerrado — nunca devuelve texto parcial ni "basura" como si
// fuera un token válido. Nunca hay fallback a texto plano: si el cifrado
// falla al conectar, la conexión se aborta sin persistir nada (ver
// completeMercadoPagoOAuthConnection en ./oauth.ts).
//
// Nunca se loguea: texto plano, ciphertext completo, la clave, el tag ni el
// IV.

import 'server-only';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ENVELOPE_PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

// Base64 ESTÁNDAR (no base64url) canónico para exactamente 32 bytes: 43
// caracteres de datos + 1 de padding '=' = 44 caracteres. Se valida el
// formato ANTES de decodificar porque `Buffer.from(x, 'base64')` es
// permisivo — puede ignorar caracteres inválidos en vez de fallar, lo que
// dejaría pasar un valor mal copiado/truncado como si fuera una clave
// válida.
const STANDARD_BASE64_32_BYTES_REGEX = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Decodifica y valida `MP_TOKEN_ENCRYPTION_KEY`. Devuelve `null` (nunca
 * lanza) si falta, si no tiene la forma canónica de base64 estándar de 32
 * bytes, o si el round-trip (recodificar y comparar) no coincide
 * exactamente con el valor original — todos los llamadores de este archivo
 * tratan `null` como "no configurado" y fallan cerrado.
 */
function loadEncryptionKey(): Buffer | null {
  const raw = process.env.MP_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;

  const normalized = raw.trim();
  if (!STANDARD_BASE64_32_BYTES_REGEX.test(normalized)) return null;

  let key: Buffer;
  try {
    key = Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }

  if (key.length !== KEY_LENGTH_BYTES) return null;

  // Round-trip canónico: si el valor no era base64 estándar "limpio" (por
  // ejemplo, algo que Buffer.from decodificó de forma permisiva), volver a
  // codificarlo no da exactamente el mismo string.
  if (key.toString('base64') !== normalized) return null;

  return key;
}

export function isMercadoPagoTokenEncryptionConfigured(): boolean {
  return loadEncryptionKey() !== null;
}

/**
 * `true` si el valor tiene la forma del envelope `enc:v1:...` (3 segmentos
 * no vacíos después del prefijo). No intenta descifrar ni valida longitudes
 * de IV/tag acá — eso lo hace `decryptMercadoPagoToken`, que es quien puede
 * fallar cerrado con detalle.
 */
export function isEncryptedMercadoPagoToken(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !value.startsWith(ENVELOPE_PREFIX)) return false;
  const parts = value.slice(ENVELOPE_PREFIX.length).split(':');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export type MercadoPagoTokenCryptoResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' | 'encryption_failed' | 'decryption_failed' };

/**
 * Cifra `plaintext` (un access_token o refresh_token de Mercado Pago) con
 * AES-256-GCM, IV aleatorio de 12 bytes nuevo en esta llamada. Nunca lanza:
 * cualquier fallo (clave ausente/inválida, error interno de node:crypto) se
 * devuelve como resultado, nunca como excepción ni como texto sin cifrar.
 */
export function encryptMercadoPagoToken(plaintext: string): MercadoPagoTokenCryptoResult<string> {
  const key = loadEncryptionKey();
  if (!key) return { ok: false, reason: 'not_configured' };

  try {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope = `${ENVELOPE_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
    return { ok: true, data: envelope };
  } catch {
    // Nunca loguear plaintext ni ningún detalle del error acá.
    return { ok: false, reason: 'encryption_failed' };
  }
}

/**
 * Descifra un envelope `enc:v1:...`. Falla cerrado (nunca devuelve texto
 * parcial) si: falta/es inválida la clave, el formato no matchea, las
 * longitudes de IV/tag no son las esperadas, o la autenticación GCM falla
 * (ciphertext o tag alterados).
 */
export function decryptMercadoPagoToken(stored: string): MercadoPagoTokenCryptoResult<string> {
  const key = loadEncryptionKey();
  if (!key) return { ok: false, reason: 'not_configured' };

  if (!isEncryptedMercadoPagoToken(stored)) return { ok: false, reason: 'decryption_failed' };

  const [ivB64, tagB64, ciphertextB64] = stored.slice(ENVELOPE_PREFIX.length).split(':');

  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');

    if (iv.length !== IV_LENGTH_BYTES || tag.length !== TAG_LENGTH_BYTES) {
      return { ok: false, reason: 'decryption_failed' };
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    // `decipher.final()` lanza si la autenticación GCM falla (tag no
    // matchea el ciphertext) — el catch de abajo lo convierte en el mismo
    // resultado "decryption_failed" que cualquier otro formato inválido,
    // nunca en texto parcial.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return { ok: true, data: plaintext };
  } catch {
    return { ok: false, reason: 'decryption_failed' };
  }
}
