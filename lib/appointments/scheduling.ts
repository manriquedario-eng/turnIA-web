// Reglas server-side compartidas para crear/editar turnos (PARTE 2 y 3 del
// pedido de corrección funcional/UX: nada de esto puede validarse sólo en
// el cliente — cualquier caller (Agenda, Planning/recurrentes, ficha del
// paciente, o lo que venga después) tiene que pasar por acá).
//
// No toca RLS, Auth, ni ningún otro archivo: son dos funciones puras de
// validación que reciben un cliente de Supabase ya autenticado (el mismo
// que ya usan las server actions) y tiran un Error con mensaje humano si
// corresponde.

import type { SupabaseClient } from '@supabase/supabase-js';

export const APPOINTMENTS_TZ = 'America/Argentina/Buenos_Aires';

export const PAST_APPOINTMENT_MESSAGE = 'No podés agendar un turno en una fecha u hora pasada.';
export const OVERLAP_MESSAGE = 'Ya existe un turno que se superpone con ese horario.';

/**
 * Tira un Error con mensaje humano si `startsAtIso` ya pasó, comparado
 * contra la hora actual real del servidor (nunca contra el input del
 * browser). Un margen de 60s absorbe el pequeño desfasaje entre el submit
 * del form y la llegada del request.
 */
export function assertNotInPast(startsAtIso: string) {
  const startsAtMs = new Date(startsAtIso).getTime();
  if (Number.isNaN(startsAtMs)) throw new Error('Fecha u hora de turno inválida.');
  if (startsAtMs < Date.now() - 60_000) {
    throw new Error(PAST_APPOINTMENT_MESSAGE);
  }
}

/**
 * Tira un Error con mensaje humano si el profesional ya tiene, en este
 * tenant, un turno activo (no cancelado) que se superpone con el rango
 * [startsAtIso, endsAtIso). Superposición = existing.starts_at < ends_at AND
 * existing.ends_at > starts_at (PARTE 2 del pedido — incluye mismo horario
 * exacto, solapamiento parcial, un turno adentro de otro, y un turno que
 * envuelve a otro).
 *
 * `excludeAppointmentId` se usa al editar, para que el turno no se detecte
 * a sí mismo como conflicto.
 */
export async function assertNoOverlap(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    professionalId: string;
    startsAtIso: string;
    endsAtIso: string;
    excludeAppointmentId?: string;
  }
) {
  const { tenantId, professionalId, startsAtIso, endsAtIso, excludeAppointmentId } = params;

  // Turnos en estado cancelado no deben bloquear el horario (PARTE 2 y 10
  // del pedido) — se excluyen ambos valores de status usados en la app
  // (`cancelled`/`cancelado`, ver lib/labels.ts) con un único `.not(...in...)`.
  const base = supabase
    .from('appointments')
    .select('id,starts_at,ends_at,patient_id')
    .eq('tenant_id', tenantId)
    .eq('professional_id', professionalId)
    .lt('starts_at', endsAtIso)
    .gt('ends_at', startsAtIso)
    .not('status', 'in', '(cancelled,cancelado)')
    .limit(1);

  const { data, error } = await (excludeAppointmentId ? base.neq('id', excludeAppointmentId) : base);
  if (error) throw new Error('No pudimos validar la disponibilidad del horario. Probá de nuevo.');
  if (data && data.length > 0) {
    const conflict: any = data[0];
    const requestedStart = new Date(startsAtIso);
    const conflictStart = new Date(conflict.starts_at);
    const conflictEnd = new Date(conflict.ends_at);
    const differenceMinutes = Math.round(Math.abs(requestedStart.getTime() - conflictStart.getTime()) / 60000);

    let patientName = 'otro paciente';
    if (conflict.patient_id) {
      const { data: patient } = await supabase
        .from('patients')
        .select('name')
        .eq('id', conflict.patient_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (patient?.name) patientName = patient.name;
    }

    const timeFormat = new Intl.DateTimeFormat('es-AR', {
      timeZone: APPOINTMENTS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const conflictStartLabel = timeFormat.format(conflictStart);
    const conflictEndLabel = timeFormat.format(conflictEnd);
    const relation = requestedStart.getTime() >= conflictStart.getTime() ? 'después' : 'antes';
    const differenceLabel = differenceMinutes === 1 ? '1 minuto' : `${differenceMinutes} minutos`;

    throw new Error(
      `Ese horario se superpone con el turno de ${patientName}, de ${conflictStartLabel} a ${conflictEndLabel}. ` +
      `El nuevo turno comienza ${differenceLabel} ${relation} del inicio de ese turno. ` +
      `Elegí un horario fuera de ese intervalo; el primer horario libre después de ese turno es ${conflictEndLabel}.`
    );
  }
}
