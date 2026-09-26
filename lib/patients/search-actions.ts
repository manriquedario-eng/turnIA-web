'use server';

// Server actions invocadas directamente desde componentes cliente (no vía
// <form>): el combobox de paciente en Agenda y el buscador global del
// Topbar. Ambos necesitan resultados en vivo mientras la persona escribe,
// sin recargar la página.

import { requireTenant } from '@/lib/auth/require-user';
import { normalizePhone, type KnownCountryPrefix } from '@/lib/phone';
import { findDuplicatePatient } from '@/lib/patients/duplicate-check';

export type PatientSearchResult = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

function escapeLikePattern(value: string) {
  // % y _ son comodines de ILIKE — un nombre que los contenga literalmente
  // (poco común, pero posible) no debe comportarse como comodín en la
  // búsqueda.
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export async function searchPatients(query: string): Promise<PatientSearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const { supabase, tenantId } = await requireTenant();
  const pattern = `%${escapeLikePattern(term)}%`;

  const { data, error } = await supabase
    .from('patients')
    .select('id, name, phone, email')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .ilike('name', pattern)
    .order('name')
    .limit(8);

  if (error || !data) return [];
  return data;
}

export type QuickCreatePatientResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string; duplicatePatientId?: string };

export async function quickCreatePatient(input: {
  name: string;
  phone?: string;
  phonePrefix?: KnownCountryPrefix;
  email?: string;
  whatsappOptIn?: boolean;
}): Promise<QuickCreatePatientResult> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: 'El nombre es obligatorio.' };

  if (!input.phone?.trim()) return { ok: false, error: 'El teléfono es obligatorio.' };
  if (!input.email?.trim()) return { ok: false, error: 'El email es obligatorio.' };

  const { supabase, tenantId } = await requireTenant();
  const phoneNormalization = normalizePhone(input.phone || null, {
    selectedPrefix: input.phone ? (input.phonePrefix ?? '+54 9') : undefined,
  });
  const email = input.email?.trim() || null;
  const whatsappOptIn = Boolean(input.whatsappOptIn);

  if (input.phone?.trim() && !phoneNormalization.isValid) {
    return {
      ok: false,
      error: phoneNormalization.note || 'El teléfono no es válido.',
    };
  }

  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'El email no es válido.' };
  }

  const duplicate = await findDuplicatePatient(supabase, {
    tenantId,
    email,
    phoneE164: phoneNormalization.e164,
  });
  if (duplicate) {
    const label = duplicate.field === 'phone' ? 'teléfono' : 'email';
    return {
      ok: false,
      error: `Ya existe un paciente con este ${label}: ${duplicate.patientName}`,
      duplicatePatientId: duplicate.patientId,
    };
  }

  const { data, error } = await supabase
    .from('patients')
    .insert({
      tenant_id: tenantId,
      name,
      phone: input.phone?.trim() || null,
      phone_e164: phoneNormalization.e164,
      email,
      // El alta rápida sólo activa WhatsApp cuando el profesional marca
      // explícitamente la autorización informada en el mini formulario.
      whatsapp_consent: whatsappOptIn,
      whatsapp_consent_at: whatsappOptIn ? new Date().toISOString() : null,
      appointment_reminders_opt_in: whatsappOptIn,
    })
    .select('id, name')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'No se pudo crear el paciente.' };
  }

  return { ok: true, id: data.id, name: data.name };
}
