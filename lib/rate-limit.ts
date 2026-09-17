import 'server-only';

// Wrapper server-side de rate limiting persistente — Fase 1 (ajustada tras
// revisión de seguridad de Dario).
//
// Depende de la función `public.check_rate_limit` propuesta en
// supabase/migrations/20260917120000_rate_limit_counters.sql (todavía NO
// aplicada a la base). Usa el cliente con SERVICE ROLE
// (lib/supabase/service.ts) exclusivamente para invocar esa RPC — la tabla
// rate_limit_counters no le otorga a 'service_role' ningún privilegio
// directo (ver esa migración): el único camino de acceso es
// check_rate_limit(), SECURITY DEFINER.
//
// `import 'server-only'` (primera línea de este archivo) hace que el build
// de Next.js falle si algún Client Component (o cualquier código que pueda
// terminar en el bundle del browser) intenta importar este módulo — no
// depende de que cada caller recuerde no hacerlo.
//
// Alcance de esta fase: SOLO este wrapper. Todavía no está integrado en
// ningún endpoint (login, /t/[token], webhook de WhatsApp, exports) — eso
// queda para la Fase 2.
//
// Privacidad de la clave: `rate_limit_counters.key` NUNCA contiene el valor
// lógico del limitador en texto plano (nada de IPs, emails, tokens públicos
// o user ids literales). El caller entrega un `scope` (namespace del
// limitador, ej. 'login-ip-email') + una `key` lógica (ej.
// `${ip}:${normalizedEmail}`), y acá se deriva un HMAC-SHA256 sobre
// `${scope}:${windowSeconds}:${key}` usando un secreto dedicado
// (RATE_LIMIT_KEY_SECRET) — nunca SUPABASE_SERVICE_ROLE_KEY ni ninguna otra
// credencial existente. La base sólo ve ese hash hexadecimal de longitud
// fija (64 caracteres). Ni la clave lógica original ni el hash resultante
// se loguean nunca, bajo ninguna circunstancia.
//
// Comportamiento ante fallas — incluyendo RATE_LIMIT_KEY_SECRET ausente:
// FAIL-OPEN. Bloquear todo el tráfico por la falta de configuración de un
// componente de hardening todavía nuevo sería peor que no tenerlo. Se
// loguea el fallo con un mensaje genérico, nunca la clave lógica ni el hash.

import { createHmac } from 'node:crypto';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  currentCount: number;
  limit: number;
};

export type CheckRateLimitInput = {
  /**
   * Identificador estable del limitador (ej. 'login-ip-email', 'login-ip',
   * 'public-token-mutation', 'export-user'). Namespacea la clave para que
   * dos limitadores distintos nunca puedan colisionar aunque reciban la
   * misma `key` lógica (ej. un mismo user id usado como key en dos
   * limitadores diferentes).
   */
  scope: string;
  /**
   * Clave lógica del limitador dentro de ese `scope` (ej. `${ip}:${email}`,
   * un public_token, un user.id). Se recibe en texto plano acá, pero NUNCA
   * llega así a la base: se deriva un HMAC antes de llamar a la RPC.
   */
  key: string;
  windowSeconds: number;
  maxCount: number;
};

type CheckRateLimitRow = {
  allowed: boolean;
  current_count: number;
  limit_count: number;
  window_start: string;
  retry_after_seconds: number;
};

const MAX_SCOPE_LENGTH = 64;
const MAX_KEY_LENGTH = 500; // clave lógica en texto plano, nunca llega a la base tal cual

function failOpenResult(maxCount: number): RateLimitResult {
  return { allowed: true, retryAfterSeconds: 0, currentCount: 0, limit: maxCount };
}

/**
 * Deriva la clave opaca que efectivamente se guarda en
 * `rate_limit_counters`: HMAC-SHA256 (hex, 64 caracteres, longitud estable)
 * sobre `${scope}:${windowSeconds}:${key}`, con `RATE_LIMIT_KEY_SECRET` como
 * secreto. Devuelve `null` si el secreto no está configurado — el caller
 * decide el fail-open en ese caso.
 *
 * `maxCount` NO se incluye en la identidad a propósito: dos límites
 * distintos sobre la misma combinación scope+key+ventana deben compartir el
 * mismo contador persistido, no fragmentarse en dos filas.
 */
function deriveOpaqueKey(scope: string, key: string, windowSeconds: number): string | null {
  const secret = process.env.RATE_LIMIT_KEY_SECRET;
  if (!secret) return null;

  const identity = `${scope}:${windowSeconds}:${key}`;
  return createHmac('sha256', secret).update(identity).digest('hex');
}

/**
 * Verifica (e incrementa atómicamente) el contador de rate limiting para
 * `scope` + `key` dentro de la ventana fija actual de `windowSeconds`
 * segundos, permitiendo como máximo `maxCount` requests por ventana.
 *
 * La base NUNCA recibe `key` en texto plano: acá se deriva un HMAC-SHA256
 * (ver `deriveOpaqueKey`) y sólo ese hash viaja como `p_key` a la RPC
 * `check_rate_limit`. Nunca lanza: cualquier fallo, de validación o de
 * infraestructura, se traduce en fail-open.
 */
export async function checkRateLimit(input: CheckRateLimitInput): Promise<RateLimitResult> {
  const { scope, key, windowSeconds, maxCount } = input;

  if (typeof scope !== 'string' || scope.trim() === '' || scope.length > MAX_SCOPE_LENGTH) {
    console.warn('rate-limit: scope inválido, fail-open');
    return failOpenResult(maxCount);
  }
  if (typeof key !== 'string' || key.trim() === '' || key.length > MAX_KEY_LENGTH) {
    console.warn('rate-limit: key inválida (vacía o demasiado larga), fail-open');
    return failOpenResult(maxCount);
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0 || windowSeconds > 86400) {
    console.warn('rate-limit: windowSeconds fuera de rango, fail-open');
    return failOpenResult(maxCount);
  }
  if (!Number.isInteger(maxCount) || maxCount <= 0 || maxCount > 1_000_000) {
    console.warn('rate-limit: maxCount fuera de rango, fail-open');
    return failOpenResult(maxCount);
  }

  const opaqueKey = deriveOpaqueKey(scope, key, windowSeconds);
  if (!opaqueKey) {
    // Mensaje exacto pedido en la revisión — nunca la key original.
    console.warn('rate-limit: RATE_LIMIT_KEY_SECRET no configurado, fail-open');
    return failOpenResult(maxCount);
  }

  if (!isServiceRoleConfigured()) {
    console.warn('rate-limit: service role no configurado, fail-open');
    return failOpenResult(maxCount);
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .rpc('check_rate_limit', {
        p_key: opaqueKey,
        p_window_seconds: windowSeconds,
        p_max_count: maxCount,
      })
      .single();

    if (error || !data) {
      // Sanitizado: nunca la key (ni lógica ni opaca), nunca el body
      // completo del error — sólo el mensaje, igual que el resto de la app
      // (ver lib/whatsapp/provider.ts, lib/email/provider.ts).
      console.error(
        'rate-limit: fallo de infraestructura al verificar el límite, fail-open',
        error?.message ?? 'respuesta vacía de check_rate_limit'
      );
      return failOpenResult(maxCount);
    }

    const row = data as unknown as CheckRateLimitRow;
    return {
      allowed: Boolean(row.allowed),
      retryAfterSeconds: Number(row.retry_after_seconds),
      currentCount: Number(row.current_count),
      limit: Number(row.limit_count),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('rate-limit: excepción al verificar el límite, fail-open', message);
    return failOpenResult(maxCount);
  }
}
