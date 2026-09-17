'use server';

import { redirect } from 'next/navigation';
import {
  cancelAppointmentByToken,
  confirmAppointmentByToken,
  requestRescheduleByToken,
} from '@/lib/appointments/public-token';
import { checkRateLimit, type RateLimitResult } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

// Rate limiting Fase 2 — acciones públicas mutantes de /t/[token]
// (confirmar/cancelar/solicitar reprogramación). Mismo patrón que
// app/login/actions.ts: se ejecuta ANTES de tocar la función de negocio, y
// si cualquiera de los límites aplicables deniega, ni siquiera se llama a
// esa función.
//
// Dos límites complementarios:
//   - public-token-mutation: por token público — protege un turno puntual
//     contra que alguien reintente confirmar/cancelar/reprogramar ese mismo
//     link muchas veces (por ejemplo, un script probando reenviar el mismo
//     link una y otra vez).
//   - public-token-ip: por IP — deliberadamente más laxo (60/15min vs
//     10/hora), porque varios pacientes de la misma sala de espera, oficina
//     o red doméstica pueden compartir la misma IP pública y todos
//     legítimamente confirmar/cancelar turnos distintos en poco tiempo.
const PUBLIC_TOKEN_MUTATION_SCOPE = 'public-token-mutation';
const PUBLIC_TOKEN_MUTATION_WINDOW_SECONDS = 3600; // 1 hora
const PUBLIC_TOKEN_MUTATION_MAX_ATTEMPTS = 10;

const PUBLIC_TOKEN_IP_SCOPE = 'public-token-ip';
const PUBLIC_TOKEN_IP_WINDOW_SECONDS = 900; // 15 minutos
const PUBLIC_TOKEN_IP_MAX_ATTEMPTS = 60;

const TOO_MANY_ATTEMPTS_MESSAGE = 'Demasiados intentos. Probá de nuevo en unos minutos.';

/**
 * Corre los límites aplicables para una mutación pública sobre `token` y
 * redirige (cortando la ejecución) si cualquiera de ellos fue excedido.
 * NUNCA revela cuál de los dos límites fue el que disparó — mismo mensaje
 * genérico en ambos casos.
 *
 * - Si `token` viene vacío, NO se ejecuta el límite por token (evita una key
 *   compartida sin sentido para "sin token") — el comportamiento actual de
 *   `confirmAppointmentByToken`/etc. ya maneja un token vacío/inválido
 *   devolviendo su propio error, sin necesidad de rate limiting encima.
 * - Si `getClientIp()` devuelve `null`, NO se ejecuta el límite por IP —
 *   nunca existe un contador global tipo 'unknown' compartido por todo el
 *   tráfico sin IP resoluble. En ese caso el único límite activo es el de
 *   token (si hay token), nunca uno global por falta de IP.
 * - Nunca loguea `token`, IP ni nada derivado de ellos.
 */
async function enforcePublicAppointmentRateLimit(token: string): Promise<void> {
  const hasToken = token.trim().length > 0;
  const ip = await getClientIp();

  const checks: Promise<RateLimitResult>[] = [];

  if (hasToken) {
    checks.push(
      checkRateLimit({
        scope: PUBLIC_TOKEN_MUTATION_SCOPE,
        key: token,
        windowSeconds: PUBLIC_TOKEN_MUTATION_WINDOW_SECONDS,
        maxCount: PUBLIC_TOKEN_MUTATION_MAX_ATTEMPTS,
      })
    );
  }

  if (ip) {
    checks.push(
      checkRateLimit({
        scope: PUBLIC_TOKEN_IP_SCOPE,
        key: ip,
        windowSeconds: PUBLIC_TOKEN_IP_WINDOW_SECONDS,
        maxCount: PUBLIC_TOKEN_IP_MAX_ATTEMPTS,
      })
    );
  }

  if (checks.length === 0) return;

  const results = await Promise.all(checks);
  const limited = results.some((result) => !result.allowed);
  if (limited) {
    redirect(`/t/${token}?error=${encodeURIComponent(TOO_MANY_ATTEMPTS_MESSAGE)}`);
  }
}

export async function confirmAppointmentPublic(formData: FormData) {
  const token = String(formData.get('token') || '');
  await enforcePublicAppointmentRateLimit(token);

  const result = await confirmAppointmentByToken(token);
  if (!result.ok) redirect(`/t/${token}?error=${encodeURIComponent(result.error)}`);
  redirect(`/t/${token}?done=confirmed`);
}

export async function cancelAppointmentPublic(formData: FormData) {
  const token = String(formData.get('token') || '');
  await enforcePublicAppointmentRateLimit(token);

  const result = await cancelAppointmentByToken(token);
  if (!result.ok) redirect(`/t/${token}?error=${encodeURIComponent(result.error)}`);
  redirect(`/t/${token}?done=cancelled`);
}

export async function requestReschedulePublic(formData: FormData) {
  const token = String(formData.get('token') || '');
  const note = String(formData.get('note') || '');
  await enforcePublicAppointmentRateLimit(token);

  const result = await requestRescheduleByToken(token, note);
  if (!result.ok) redirect(`/t/${token}?error=${encodeURIComponent(result.error)}`);
  redirect(`/t/${token}?done=reschedule_requested`);
}
