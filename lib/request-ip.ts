import 'server-only';

import { headers } from 'next/headers';

// IP pública del cliente para rate limiting. Nunca se usa para autorización.
//
// Vercel documenta que `x-vercel-forwarded-for` es equivalente a
// `x-forwarded-for`, pero resulta preferible cuando existe un proxy/CDN
// delante de Vercel porque `x-forwarded-for` puede ser sobrescrito por ese
// proxy. TurnIA prioriza por eso `x-vercel-forwarded-for` y usa
// `x-forwarded-for` sólo como fallback.
//
// La IP nunca se persiste en texto plano: lib/rate-limit.ts deriva una clave
// HMAC opaca antes de enviarla a la base.
//
// Si ninguno de los dos headers está disponible se devuelve null. Los callers
// deben omitir el límite por IP en ese caso; nunca usar una clave global
// compartida tipo "unknown".

function firstForwardedIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

export async function getClientIp(): Promise<string | null> {
  const headerList = await headers();

  const vercelForwardedFor = firstForwardedIp(
    headerList.get('x-vercel-forwarded-for'),
  );
  if (vercelForwardedFor) return vercelForwardedFor;

  return firstForwardedIp(headerList.get('x-forwarded-for'));
}
