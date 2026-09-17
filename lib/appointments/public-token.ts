// Lectura/escritura de un turno a través de su `public_token` (PARTE 17-20
// del pedido de la pasada final). Usado SÓLO por las páginas/acciones
// públicas de /t/[token] — nunca por nada del área autenticada.
//
// Por qué service role acá: la persona que abre el link NO tiene sesión de
// TurnIA (esa es justo la idea — no debería necesitar cuenta), así que no
// hay RLS de usuario que aplicar. Se usa `createSupabaseServiceClient()`
// (mismo cliente ya usado para `google_oauth_connections`, ver
// lib/supabase/service.ts) pero SIEMPRE filtrando por el token exacto — un
// uuid impredecible, exclusivo de un turno — nunca con una query abierta
// sobre toda la tabla. Ninguna función acá devuelve tenant_id ni ningún
// dato de otro turno o de otro paciente.

import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';

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

/**
 * Busca un turno por su token público. Devuelve `null` si el token no tiene
 * forma de uuid, si el service role no está configurado, o si no matchea
 * ningún turno — en los tres casos la página pública debe mostrar "turno no
 * encontrado" sin distinguir el motivo (no filtrar por qué falló).
 */
export async function getAppointmentByPublicToken(token: string): Promise<PublicAppointment | null> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return null;

  const supabase = createSupabaseServiceClient();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, tenant_id, patient_id, professional_id, service_id, starts_at, ends_at, modality, status, meeting_url, reschedule_requested_at')
    .eq('public_token', token)
    .maybeSingle();

  if (error) {
    logSupabaseError('getAppointmentByPublicToken', token, error);
    return null;
  }
  if (!appointment) return null;

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

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

export type PublicActionResult = { ok: true } | { ok: false; error: string };

/** Confirma el turno. No hace nada (pero no falla) si ya estaba cancelado o ya confirmado. */
export async function confirmAppointmentByToken(token: string): Promise<PublicActionResult> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return { ok: false, error: 'Enlace inválido.' };
  const supabase = createSupabaseServiceClient();

  const { data: appointment, error: selectError } = await supabase.from('appointments').select('id, status').eq('public_token', token).maybeSingle();
  if (selectError) {
    logSupabaseError('confirmAppointmentByToken:select', token, selectError);
    return { ok: false, error: 'No encontramos este turno.' };
  }
  if (!appointment) return { ok: false, error: 'No encontramos este turno.' };
  if (isCancelled(appointment.status)) return { ok: false, error: 'Este turno ya está cancelado y no se puede confirmar.' };

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('public_token', token);

  if (error) {
    logSupabaseError('confirmAppointmentByToken:update', token, error);
    return { ok: false, error: 'No pudimos confirmar el turno. Probá de nuevo en unos minutos.' };
  }
  return { ok: true };
}

/** Cancela el turno. Idempotente: si ya estaba cancelado, devuelve ok igual. */
export async function cancelAppointmentByToken(token: string): Promise<PublicActionResult> {
  if (!isPlausibleToken(token) || !isServiceRoleConfigured()) return { ok: false, error: 'Enlace inválido.' };
  const supabase = createSupabaseServiceClient();

  const { data: appointment, error: selectError } = await supabase.from('appointments').select('id, status').eq('public_token', token).maybeSingle();
  if (selectError) {
    logSupabaseError('cancelAppointmentByToken:select', token, selectError);
    return { ok: false, error: 'No encontramos este turno.' };
  }
  if (!appointment) return { ok: false, error: 'No encontramos este turno.' };
  if (isCancelled(appointment.status)) return { ok: true };

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('public_token', token);

  if (error) {
    logSupabaseError('cancelAppointmentByToken:update', token, error);
    return { ok: false, error: 'No pudimos cancelar el turno. Probá de nuevo en unos minutos.' };
  }
  return { ok: true };
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

  const { data: appointment, error: selectError } = await supabase.from('appointments').select('id, status').eq('public_token', token).maybeSingle();
  if (selectError) {
    logSupabaseError('requestRescheduleByToken:select', token, selectError);
    return { ok: false, error: 'No encontramos este turno.' };
  }
  if (!appointment) return { ok: false, error: 'No encontramos este turno.' };
  if (isCancelled(appointment.status)) return { ok: false, error: 'Este turno ya está cancelado.' };

  const { error } = await supabase
    .from('appointments')
    .update({
      reschedule_requested_at: new Date().toISOString(),
      reschedule_note: note.trim().slice(0, 500) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('public_token', token);

  if (error) {
    logSupabaseError('requestRescheduleByToken:update', token, error);
    return { ok: false, error: 'No pudimos registrar la solicitud. Probá de nuevo en unos minutos.' };
  }
  return { ok: true };
}
