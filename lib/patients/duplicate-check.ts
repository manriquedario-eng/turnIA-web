// Detección de pacientes duplicados dentro de un mismo consultorio
// (tenant_id). Nunca compara entre tenants distintos.
//
// Reglas explícitas (PARTE 7/8 del pedido de Dario):
// - Email: se compara normalizado (trim + lowercase). Se ignoran pacientes
//   sin email.
// - Teléfono: se compara por `phone_e164` únicamente — nunca por el string
//   crudo `phone` (distintos formatos/espacios/guiones darían falsos
//   negativos o positivos). Un paciente cuyo teléfono no pudo normalizarse
//   a E.164 (frecuente con números argentinos sin código de país) queda
//   fuera de esta verificación; es una limitación conocida, documentada acá
//   y en lib/phone.ts, no un bug.
// - Sólo pacientes activos (`deleted_at is null`) cuentan como conflicto.
// - Al editar, el propio paciente (`excludePatientId`) nunca se cuenta
//   contra sí mismo.

import type { SupabaseClient } from '@supabase/supabase-js';

export type DuplicateConflict = {
  field: 'email' | 'phone';
  patientId: string;
  patientName: string;
};

export function normalizeEmailForCompare(email: string | null | undefined) {
  const trimmed = (email ?? '').trim().toLowerCase();
  return trimmed || null;
}

export async function findDuplicatePatient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  params: {
    tenantId: string;
    email: string | null;
    phoneE164: string | null;
    excludePatientId?: string;
  },
): Promise<DuplicateConflict | null> {
  const email = normalizeEmailForCompare(params.email);
  const phoneE164 = params.phoneE164?.trim() || null;

  if (!email && !phoneE164) return null;

  // Traemos los candidatos con contacto cargado y comparamos en memoria con
  // igualdad exacta (no ILIKE): el email puede tener "_" en la parte local,
  // que en SQL LIKE/ILIKE es un comodín de un carácter, y eso generaría
  // falsos positivos ("john_doe@x.com" "matchearía" "johnxdoe@x.com"). Con
  // igualdad exacta en JS ese riesgo no existe.
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, email, phone_e164')
    .eq('tenant_id', params.tenantId)
    .is('deleted_at', null)
    .or('email.not.is.null,phone_e164.not.is.null')
    .limit(2000);

  if (error || !data) return null;

  for (const candidate of data) {
    if (params.excludePatientId && candidate.id === params.excludePatientId) continue;
    if (phoneE164 && candidate.phone_e164 === phoneE164) {
      return { field: 'phone', patientId: candidate.id, patientName: candidate.name };
    }
  }
  // El email se revisa en una segunda pasada para priorizar el conflicto de
  // teléfono cuando ambos coinciden con paciente distintos.
  for (const candidate of data) {
    if (params.excludePatientId && candidate.id === params.excludePatientId) continue;
    if (email && normalizeEmailForCompare(candidate.email) === email) {
      return { field: 'email', patientId: candidate.id, patientName: candidate.name };
    }
  }

  return null;
}
