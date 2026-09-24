// Lectura/escritura de un turno a través de su `public_token` (PARTE 17-20
// del pedido de la pasada final, + vencimiento/revocación de esta pasada de
// hardening). Usado SÓLO por las páginas/acciones públicas de /t/[token] —
// nunca por nada del área autenticada.
//
// Por qué service role acá: la persona que abre el link NO tiene sesión de
// TurnIA (esa es justo la idea — no debería necesitar cuenta), así que no
// hay RLS de usuario que aplicar. Se usa `createSupabaseServiceClient()`
// (mismo cliente ya usado para `google_oauth_connections`, ver
// lib/supabase/service.ts) pero SIEMPRE filtrando por el token exacto — un
// uuid impredecible, exclusivo de un turno — nunca con una query abierta
// sobre toda la tabla. Ninguna función acá devuelve tenant_id ni ningún
// dato de otro turno o de otro paciente.
//
// VENCIMIENTO Y REVOCACIÓN (nuevo en esta pasada):
//
// El link público vence en `ends_at + 24 horas` — a propósito NO existe una
// columna fija de expiración: un turno puede crearse semanas antes, el link
// tiene que seguir funcionando hasta entonces, y si el profesional
// reprograma el turno (cambia `ends_at`), el vencimiento del link lo
// acompaña automáticamente sin sincronizar dos columnas. Ver
// `PUBLIC_TOKEN_GRACE_MS` y `resolveTokenState` más abajo.
//
// Además existe `appointments.public_token_revoked_at` (migración
// 20260917180000_appointment_public_token_revocation.sql, propuesta, NO
// aplicada todavía): NULL = vigente (sujeto sólo al vencimiento de arriba),
// fecha presente = revocado para siempre, sin importar `ends_at`. Ninguna
// función de este archivo escribe esa columna hoy — no existe todavía
// ninguna acción de "revocar" ni de "regenerar link". Una futura función de
// regeneración debería generar un `public_token` nuevo (gen_random_uuid())
// Y limpiar (NULL) `public_token_revoked_at` de la fila — no se implementa
// en esta pasada.
//
// A propósito, cancelar un turno desde el propio link público NO revoca su
// token (ver `cancelAppointmentByToken`): después del POST el navegador
// redirige de nuevo a `/t/[token]` para mostrar el resultado, y revocar de
// inmediato convertiría esa redirección en un falso "enlace inválido". El
// turno cancelado queda sujeto al vencimiento normal, igual que cualquier
// otro.
//
// Ningún estado interno (revocado vs. vencido vs. inexistente) se filtra al
// paciente ni a quien esté probando tokens al azar: la página pública
// siempre muestra "enlace no disponible" genérico, y las acciones siempre
// devuelven el mismo mensaje genérico, sin distinguir el motivo.
//
// MUTACIONES (confirmar/cancelar/reprogramar): a partir de esta pasada usan
// EXCLUSIVAMENTE las RPC atómicas de
// supabase/migrations/20260917180000_appointment_public_token_revocation.sql
// (confirm_public_appointment / cancel_public_appointment /
// request_public_appointment_reschedule) — ya NO hay ningún SELECT ni
// UPDATE directo sobre `appointments` en este archivo para las mutaciones.
// Ver el comentario de esa migración para el detalle de por qué (defensa
// TOCTOU con clock_timestamp() + doble chequeo, evaluada enteramente dentro
// de Postgres). La lectura (`getAppointmentByPublicToken`) no es
// TOCTOU-sensible (sólo lee) y sigue haciendo su propio SELECT +
// `resolveTokenState`, sin cambios.

import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { runAppointmentCancellationSideEffects } from '@/lib/appointments/cancellation-side-effects';

export type PublicAppointment = {
  id: string;
  tenantId: string;
  startsAt: string;
  endsAt: string;
  modality: string | null;
  status: string | null;
  meetingUrl: string | null;
  patientName: string;
  professionalName: string;
  serviceName: string | null;
  rescheduleRequestedAt: string | null;
};

const TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlausibleToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && TOKEN_REGEX.test(value.trim());
}

/**
 * Log sanitizado de un error de Supabase en el flujo público por token.
 * Nunca recibe ni loguea el token completo, credenciales ni datos clínicos —
 * sólo los primeros 8 caracteres del token (suficiente para correlacionar
 * con logs/DB sin exponer el identificador completo) y los campos propios
 * del PostgrestError (code/message/hint/details), que nunca contienen
 * secretos ni PII: son metadata del motor de base de datos.
 */
function logSupabaseError(operation: string, token: string, error: { code?: string; message?: string; hint?: string; details?: string }) {
  const tokenPrefix = typeof token === 'string' ? token.slice(0, 8) : 'n/a';
  console.error(`public-token: fallo de Supabase en ${operation}`, {
    tokenPrefix,
    code: error.code ?? null,
    message: error.message ?? null,
    hint: error.hint ?? null,
    details: error.details ?? null,
  });
}

// ---------------------------------------------------------------------------
// Vencimiento y revocación — helper centralizado (sólo para lectura pública)
// ---------------------------------------------------------------------------

/** Gracia después de `ends_at` durante la cual el link sigue siendo válido. */
const PUBLIC_TOKEN_GRACE_MS = 24 * 60 * 60 * 1000; // 24 horas

type TokenGateRow = {
  ends_at: string;
  public_token_revoked_at: string | null;
};

type TokenState = 'valid' | 'revoked' | 'expired';

/**
 * Determina el estado real del link (nunca confiando en nada que no sea el
 * propio dato de la fila + la hora real del servidor). `now` es un
 * parámetro inyectable sólo para poder testear; en producción siempre es
 * `new Date()` — jamás una fecha que pueda venir del cliente.
 *
 * NUNCA usar el resultado de esto para mostrarle al paciente/atacante CUÁL
 * fue el motivo — sólo para decidir internamente si se sigue o se corta.
 *
 * Usado únicamente por `getAppointmentByPublicToken` (lectura). Las
 * mutaciones ya no usan esta función: su chequeo de vigencia vive
 * enteramente dentro de las RPC de Postgres (ver comentario al inicio del
 * archivo).
 */
function resolveTokenState(row: TokenGateRow, now: Date = new Date()): TokenState {
  if (row.public_token_revoked_at !== null) return 'revoked';

  const endsAtMs = new Date(row.ends_at).getTime();
  // Fecha corrupta/no parseable: tratar como vencido, nunca como válido.
  if (Number.isNaN(endsAtMs) || endsAtMs + PUBLIC_TOKEN_GRACE_MS <= now.getTime()) {
    return 'expired';
  }
  return 'valid';
}

const GENERIC_LINK_UNAVAILABLE_MESSAGE = 'Este enlace ya no está disponible.';

/**
 * Busca un turno por su token público. Devuelve `null` si el token no tiene
 * forma de uuid, si el service role no está configurado, si no matchea
 * ningún turno, si el link fue revocado, o si ya venció (ends_at + 24hs) —
 * en TODOS los casos la página pública debe mostrar "turno no encontrado"
 * sin distinguir el motivo (no filtrar por qué falló).
 */
export async function getAppointmentByPublicToken(token: string): Promise<PublicAppointment | null> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return null;

  const supabase = createSupabaseServiceClient();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, tenant_id, patient_id, professional_id, service_id, starts_at, ends_at, modality, status, meeting_url, reschedule_requested_at, public_token_revoked_at')
    .eq('public_token', token)
    .maybeSingle();

  if (error) {
    logSupabaseError('getAppointmentByPublicToken', token, error);
    return null;
  }
  if (!appointment) return null;

  // Vencido o revocado: mismo tratamiento que "no encontrado". Nunca se
  // distingue el motivo, y `public_token_revoked_at` nunca se incluye en el
  // objeto devuelto más abajo (no se expone al frontend en ningún caso).
  if (resolveTokenState(appointment) !== 'valid') return null;

  const [{ data: patient }, { data: profile }, { data: service }] = await Promise.all([
    appointment.patient_id
      ? supabase.from('patients').select('name').eq('id', appointment.patient_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appointment.professional_id
      ? supabase.from('profiles').select('display_name').eq('id', appointment.professional_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appointment.service_id
      ? supabase.from('services').select('name').eq('id', appointment.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id: appointment.id,
    tenantId: appointment.tenant_id,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    modality: appointment.modality,
    status: appointment.status,
    meetingUrl: appointment.meeting_url,
    patientName: patient?.name || 'Paciente',
    professionalName: profile?.display_name || 'tu profesional',
    serviceName: service?.name ?? null,
    rescheduleRequestedAt: appointment.reschedule_requested_at ?? null,
  };
}

export type PublicActionResult = { ok: true } | { ok: false; error: string };

/**
 * Forma de fila que devuelven las tres RPC atómicas de
 * 20260917180000_appointment_public_token_revocation.sql — todas
 * `returns table (result text)`, siempre una única fila. Mismo patrón de
 * llamada que `check_rate_limit` en lib/rate-limit.ts: `.rpc(...).single()`.
 * `(string & {})` deja pasar cualquier string sin romper el autocompletado
 * de los tres valores conocidos — la rama `else` de cada función de abajo
 * cubre cualquier valor no reconocido con el mismo mensaje genérico.
 */
type PublicMutationRpcRow = {
  result: 'ok' | 'already_cancelled' | 'already_requested' | 'not_available' | (string & {});
};

/**
 * Confirma el turno vía la RPC atómica `confirm_public_appointment`. TODA la
 * lógica de vigencia (revocado/vencido) y de idempotencia vive en Postgres
 * (ver la migración citada arriba) — acá no se hace ningún SELECT ni UPDATE
 * directo sobre `appointments`, sólo se interpreta el `result` devuelto.
 */
export async function confirmAppointmentByToken(token: string): Promise<PublicActionResult> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return { ok: false, error: 'Enlace inválido.' };
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase.rpc('confirm_public_appointment', { p_token: token }).single();

  if (error || !data) {
    logSupabaseError('confirmAppointmentByToken:rpc', token, error ?? {});
    return { ok: false, error: 'No pudimos confirmar el turno. Probá de nuevo en unos minutos.' };
  }

  const result = (data as unknown as PublicMutationRpcRow).result;
  if (result === 'ok') return { ok: true };
  if (result === 'already_cancelled') {
    return { ok: false, error: 'Este turno ya está cancelado y no se puede confirmar.' };
  }
  // 'not_available' o cualquier valor inesperado: mismo mensaje genérico,
  // nunca se filtra el motivo real (inexistente/revocado/vencido/otro).
  return { ok: false, error: GENERIC_LINK_UNAVAILABLE_MESSAGE };
}

/**
 * Cancela el turno. Idempotente: si ya estaba cancelado, devuelve ok igual.
 *
 * A propósito NO revoca `public_token_revoked_at` acá (ver comentario al
 * inicio del archivo): el turno cancelado sigue sujeto al vencimiento
 * normal (ends_at + 24hs), igual que cualquier otro. Tampoco cambia el
 * comportamiento de cancelación del profesional (esa es otra función, en
 * app/(protected)/agenda/actions.ts, no tocada acá).
 */
export async function cancelAppointmentByToken(token: string): Promise<PublicActionResult> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return { ok: false, error: 'Enlace inválido.' };
  const supabase = createSupabaseServiceClient();

  // Contexto mínimo para efectos posteriores. La mutación NO confía en esta
  // lectura: la cancelación y su idempotencia siguen resueltas atómicamente
  // por cancel_public_appointment dentro de Postgres.
  const { data: context } = await supabase
    .from('appointments')
    .select('id,tenant_id,patient_id,professional_id,starts_at,external_calendar_event_id')
    .eq('public_token', token)
    .maybeSingle();

  const { data, error } = await supabase.rpc('cancel_public_appointment', { p_token: token }).single();

  if (error || !data) {
    logSupabaseError('cancelAppointmentByToken:rpc', token, error ?? {});
    return { ok: false, error: 'No pudimos cancelar el turno. Probá de nuevo en unos minutos.' };
  }

  const result = (data as unknown as PublicMutationRpcRow).result;

  if (result === 'already_cancelled') {
    return { ok: true };
  }

  if (result === 'ok') {
    if (context?.professional_id) {
      try {
        await runAppointmentCancellationSideEffects({
          supabase,
          tenantId: context.tenant_id,
          professionalUserId: context.professional_id,
          appointmentId: context.id,
          patientId: context.patient_id ?? null,
          startsAt: context.starts_at,
          externalCalendarEventId: context.external_calendar_event_id ?? null,
        });
      } catch {
        console.error('public-token: cancellation side effects failed', {
          appointmentId: context.id,
        });
      }
    }
    return { ok: true };
  }

  return { ok: false, error: GENERIC_LINK_UNAVAILABLE_MESSAGE };
}

/**
 * Primera versión segura de reprogramación (PARTE 20 del pedido): todavía
 * no hay un motor de disponibilidad confiable para que el paciente elija
 * otro horario solo, así que esto sólo REGISTRA la solicitud — no mueve el
 * turno — para que el profesional la gestione desde TurnIA.
 */
export async function requestRescheduleByToken(token: string, note: string): Promise<PublicActionResult> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return { ok: false, error: 'Enlace inválido.' };
  const supabase = createSupabaseServiceClient();

  // La RPC ya hace trim, string vacío -> NULL y tope de 500 caracteres
  // server-side (ver la migración) — se manda `note` tal cual, sin
  // reprocesarla acá, para no tener dos lugares con la misma lógica de
  // saneamiento que puedan divergir.
  const { data, error } = await supabase
    .rpc('request_public_appointment_reschedule', { p_token: token, p_note: note })
    .single();

  if (error || !data) {
    logSupabaseError('requestRescheduleByToken:rpc', token, error ?? {});
    return { ok: false, error: 'No pudimos registrar la solicitud. Probá de nuevo en unos minutos.' };
  }

  const result = (data as unknown as PublicMutationRpcRow).result;
  if (result === 'ok' || result === 'already_requested') return { ok: true };
  if (result === 'already_cancelled') {
    return { ok: false, error: 'Este turno ya está cancelado.' };
  }
  return { ok: false, error: GENERIC_LINK_UNAVAILABLE_MESSAGE };
}
