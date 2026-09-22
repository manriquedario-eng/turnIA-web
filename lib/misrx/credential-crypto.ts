import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

function loadKey(): Buffer | null {
  const raw = process.env.MISRX_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw || !BASE64_32.test(raw)) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== raw) return null;
    return key;
  } catch {
    return null;
  }
}

export function isMisRxCredentialEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

export type MisRxCryptoResult =
  | { ok: true; data: string }
  | { ok: false; reason: 'not_configured' | 'encryption_failed' | 'decryption_failed' };

export function encryptMisRxCredential(value: string): MisRxCryptoResult {
  const key = loadKey();
  if (!key) return { ok: false, reason: 'not_configured' };
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ok: true,
      data: `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`,
    };
  } catch {
    return { ok: false, reason: 'encryption_failed' };
  }
}

export function decryptMisRxCredential(value: string): MisRxCryptoResult {
  const key = loadKey();
  if (!key) return { ok: false, reason: 'not_configured' };
  if (!value.startsWith(PREFIX)) return { ok: false, reason: 'decryption_failed' };

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return { ok: false, reason: 'decryption_failed' };

  try {
    const [ivRaw, tagRaw, cipherRaw] = parts;
    const iv = Buffer.from(ivRaw, 'base64url');
    const tag = Buffer.from(tagRaw, 'base64url');
    const ciphertext = Buffer.from(cipherRaw, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      return { ok: false, reason: 'decryption_failed' };
    }
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return { ok: true, data: plaintext };
  } catch {
    return { ok: false, reason: 'decryption_failed' };
  }
}
