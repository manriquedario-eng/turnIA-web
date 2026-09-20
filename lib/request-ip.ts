import 'server-only';

import { headers } from 'next/headers';

// IP pública del cliente, para usar como parte de la `key` lógica de rate
// limiting (ver lib/rate-limit.ts) — NUNCA para autorización ni para
// decisiones de seguridad más allá de contar intentos.
//
// Fuente elegida: `x-forwarded-for`. Cita textual de la documentación
// oficial de Vercel (Request headers → "x-forwarded-for"):
//
//   "The public IP address of the client that made the request. If you are
//   trying to use Vercel behind a proxy, we currently overwrite the
//   X-Forwarded-For header and do not forward external IPs. This
//   restriction is in place to prevent IP spoofing."
//   (https://vercel.com/docs/headers/request-headers)
//
// Es decir: en un deploy de Vercel SIN otro proxy externo delante (no es el
// caso de TurnIA hoy — no hay Cloudflare/WAF de terceros por delante),
// Vercel sobrescribe este header con la IP real de la conexión TCP que
// llega a su borde, descartando cualquier valor que el cliente haya podido
// mandar. No es un header "de cliente" en este contexto — es Vercel
// escribiéndolo. Por eso NO hace falta desconfiar de él acá ni tratarlo
// como spoofeable, a diferencia de la recomendación genérica de "nunca
// confíes en x-forwarded-for sin más".
//
// Si en algún momento TurnIA se pusiera detrás de otro proxy externo
// (Cloudflare u otro WAF/CDN delante de Vercel), Vercel documenta
// `x-vercel-forwarded-for` como la variante que sigue siendo confiable en
// ese escenario, porque `x-forwarded-for` ahí sí podría venir modificado
// por ese proxy intermedio antes de llegar a Vercel. Hoy no aplica, pero
// queda anotado acá para revisar si la infraestructura cambia.
//
// A propósito NO hay fallback a `x-real-ip` (ni a ningún otro header):
// aunque Vercel documenta `x-real-ip` como idéntico a `x-forwarded-for`,
// esa garantía de "sobrescrito por Vercel, no spoofeable" está confirmada
// documentalmente sólo para `x-forwarded-for` en este escenario de deploy.
// Preferimos devolver `null` — y dejar que el caller use su camino sin IP —
// antes que confiar en una fuente distinta sin la misma garantía explícita.
//
// Devuelve `null` si `x-forwarded-for` no está presente o viene vacío — el
// caller (por ahora sólo app/login/actions.ts) es responsable de NO tratar
// "sin IP" como una única key global compartida (ver ese archivo: usa el
// scope separado 'login-email-noip', por email, en ese caso).
export async function getClientIp(): Promise<string | null> {
  const headerList = await headers();

  const forwardedFor = headerList.get('x-forwarded-for');
  if (!forwardedFor) return null;

  const first = forwardedFor.split(',')[0]?.trim();
  return first || null;
}
