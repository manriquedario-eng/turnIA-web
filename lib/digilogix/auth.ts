import 'server-only';

import { createCipheriv, pbkdf2Sync } from 'crypto';
import type { DigilogixConfig } from './config';

const AES_BLOCK_BYTES = 16;

function formatProviderDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;

  if (!day || !month || !year) throw new Error('digilogix_invalid_auth_date');
  return `${day}/${month}/${year}`;
}

function zeroPad(input: Buffer): Buffer {
  const remainder = input.length % AES_BLOCK_BYTES;
  if (remainder === 0) return input;
  return Buffer.concat([input, Buffer.alloc(AES_BLOCK_BYTES - remainder, 0)]);
}

/**
 * Replica el ejemplo C# entregado por Digilogix:
 * - Rfc2898DeriveBytes histórico: PBKDF2-HMAC-SHA1, 1000 iteraciones.
 * - 256 bits de key.
 * - Rijndael/AES CBC.
 * - IV = el valor que el ejemplo del proveedor denomina "Key".
 * - PaddingMode.Zeros.
 *
 * No se registra ni se devuelve ninguno de los secretos usados.
 */
export function buildDigilogixAuthorizationToken(
  config: DigilogixConfig,
  now = new Date(),
): string {
  const providerDate = formatProviderDate(now, config.authTimeZone);
  const plainText = `${config.authLogin}|${providerDate}|${config.authClient}|${config.authPassword}`;

  const salt = Buffer.from(config.salt, 'ascii');
  const iv = Buffer.from(config.iv, 'ascii');

  if (iv.length !== AES_BLOCK_BYTES) {
    throw new Error('digilogix_invalid_iv_length');
  }

  const key = pbkdf2Sync(config.privateKey, salt, 1000, 32, 'sha1');
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);

  const padded = zeroPad(Buffer.from(plainText, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString('base64');
}
