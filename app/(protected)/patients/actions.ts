'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { normalizePhone, type KnownCountryPrefix } from '@/lib/phone';
import { findDuplicatePatient } from '@/lib/patients/duplicate-check';

const KNOWN_PREFIXES = new Set<KnownCountryPrefix>(['+54 9', '+54', '+598', '+595', '+56', '+34', '+1']);

// `PhoneInput` manda el prefijo elegido en un campo separado
// (`<name>_country_prefix`, vacío en modo manual). Se valida contra la
// lista conocida antes de pasarlo a `normalizePhone` — un valor
// inesperado se ignora (cae al parseo de siempre) en vez de romper la carga.
function readSelectedPrefix(formData: FormData, fieldName = 'phone_country_prefix'): KnownCountryPrefix | undefined {
  const value = formData.get(fieldName);
  if (typeof value !== 'string' || !value) return undefined;
  return KNOWN_PREFIXES.has(value as KnownCountryPrefix) ? (value as KnownCountryPrefix) : undefined;
}

function duplicateRedirectQuery(conflict: { field: 'email' | 'phone'; patientId: string; patientName: string }) {
  const label = conflict.field === 'phone' ? 'teléfono' : 'email';
  const message = `Ya existe un paciente con este ${label}: ${conflict.patientName}`;
  return `error=${encodeURIComponent(message)}&duplicate_patient_id=${conflict.patientId}`;
}

const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(160).nullable().optional()
);

// Checkbox HTML: cuando está tildado, FormData trae 'on' (o el value que se le
// haya dado); cuando no está tildado, el campo directamente no viene en el
// FormData. Por eso el preprocess trata "ausente" y "off" como false, nunca
// como true — el consentimiento nunca se infiere ni se asume por defecto.
const checkboxBoolean = z.preprocess(
  (value) => value === 'on' || value === 'true' || value === true,
  z.boolean()
);

const patientSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'El nombre es obligatorio').max(160),
  phone: optionalText,
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().email('Email inválido').max(200).nullable().optional()
  ),
  dni: optionalText,
  insurance_name: optionalText,
  insurance_member_number: optionalText,
  insurance_plan: optionalText,
  care_location: optionalText,
  default_price: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.coerce.number().nonnegative().nullable().optional()
  ),
  whatsapp_consent: checkboxBoolean,
  appointment_reminders_opt_in: checkboxBoolean,
});

function formDataToPatient(formData: FormData) {
  return patientSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    dni: formData.get('dni'),
    insurance_name: formData.get('insurance_name'),
    insurance_member_number: formData.get('insurance_member_number'),
    insurance_plan: formData.get('insurance_plan'),
    care_location: formData.get('care_location'),
    default_price: formData.get('default_price'),
    whatsapp_consent: formData.get('whatsapp_consent'),
    appointment_reminders_opt_in: formData.get('appointment_reminders_opt_in'),
  });
}

export async function createPatient(formData: FormData) {
  const parsed = formDataToPatient(formData);
  if (!parsed.success) {
    redirect(`/patients?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Datos inválidos')}`);
  }

  const { supabase, tenantId } = await requireTenant();
  const { id: _id, ...payload } = parsed.data;
  const phoneNormalization = normalizePhone(payload.phone ?? null, { selectedPrefix: readSelectedPrefix(formData) });

  const duplicate = await findDuplicatePatient(supabase, {
    tenantId,
    email: payload.email ?? null,
    phoneE164: phoneNormalization.e164,
  });
  if (duplicate) redirect(`/patients?${duplicateRedirectQuery(duplicate)}`);

  const { error } = await supabase.from('patients').insert({
    tenant_id: tenantId,
    ...payload,
    phone_e164: phoneNormalization.e164,
    whatsapp_consent_at: payload.whatsapp_consent ? new Date().toISOString() : null,
  });

  if (error) {
    redirect(`/patients?error=${encodeURIComponent('No se pudo crear el paciente')}`);
  }

  revalidatePath('/patients');
  redirect('/patients?success=created');
}

export async function updatePatient(formData: FormData) {
  const parsed = formDataToPatient(formData);
  if (!parsed.success || !parsed.data.id) {
    redirect('/patients?error=Datos%20inválidos');
  }

  const { supabase, tenantId } = await requireTenant();
  const { id, ...payload } = parsed.data;
  const phoneNormalization = normalizePhone(payload.phone ?? null, { selectedPrefix: readSelectedPrefix(formData) });

  const duplicate = await findDuplicatePatient(supabase, {
    tenantId,
    email: payload.email ?? null,
    phoneE164: phoneNormalization.e164,
    excludePatientId: id,
  });
  if (duplicate) redirect(`/patients/${id}?${duplicateRedirectQuery(duplicate)}`);

  // El timestamp de consentimiento sólo se actualiza en una transición real
  // false -> true (se guarda cuándo se otorgó), y se limpia si se revoca.
  // Si ya estaba en true y sigue en true, se conserva la fecha original.
  const { data: existing } = await supabase
    .from('patients')
    .select('whatsapp_consent, whatsapp_consent_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  let whatsappConsentAt: string | null = existing?.whatsapp_consent_at ?? null;
  if (payload.whatsapp_consent && !existing?.whatsapp_consent) {
    whatsappConsentAt = new Date().toISOString();
  } else if (!payload.whatsapp_consent) {
    whatsappConsentAt = null;
  }

  const { data, error } = await supabase
    .from('patients')
    .update({
      ...payload,
      phone_e164: phoneNormalization.e164,
      whatsapp_consent_at: whatsappConsentAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    redirect(`/patients/${id}?error=${encodeURIComponent('No se pudo actualizar el paciente')}`);
  }

  revalidatePath('/patients');
  revalidatePath(`/patients/${id}`);
  redirect(`/patients/${id}?success=updated`);
}

export async function archivePatient(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect('/patients?error=Paciente%20inválido');

  const { supabase, tenantId } = await requireTenant();
  const { data, error } = await supabase
    .from('patients')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    redirect(`/patients/${id.data}?error=${encodeURIComponent('No se pudo archivar el paciente')}`);
  }

  revalidatePath('/patients');
  redirect('/patients?success=archived');
}

// Sesiones y Seguimientos son la misma tabla (`patient_follow_ups`) — no se
// creó ninguna tabla nueva. `appointment_id` sigue siendo la fuente
// estructural de verdad (obligatorio para sesión, null para seguimiento),
// pero ahora además se marca explícitamente en `source_type`
// ('manual_session' / 'manual_follow_up') para no depender solamente de la
// presencia de `appointment_id` al leer. Registros viejos con
// source_type = 'manual_text' se mantienen tal cual (no se migran) y se
// siguen clasificando por `appointment_id` al leer, por compatibilidad.
// El formulario de la ficha del paciente decide cuál es cuál según si la
// persona eligió un turno o dejó "Seguimiento general".
export async function createManualFollowUp(formData: FormData) {
  const parsed = z.object({
    patientId: z.string().uuid(),
    content: z.string().trim().min(2, 'La nota no puede estar vacía').max(10000),
    appointmentId: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().uuid().optional(),
    ),
  }).safeParse({
    patientId: formData.get('patientId'),
    content: formData.get('content'),
    appointmentId: formData.get('appointmentId'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Nota%20inválida');
  }

  const { supabase, tenantId, user } = await requireTenant();
  const { data: patient } = await supabase
    .from('patients')
    .select('id')
    .eq('id', parsed.data.patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!patient) {
    redirect('/patients?error=Paciente%20no%20disponible');
  }

  // Si se indicó un turno, se valida que exista y sea del mismo paciente y
  // consultorio — nunca se confía en un appointment_id llegado del cliente
  // sin verificar tenant_id/patient_id.
  if (parsed.data.appointmentId) {
    const { data: appointment } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', parsed.data.appointmentId)
      .eq('tenant_id', tenantId)
      .eq('patient_id', parsed.data.patientId)
      .maybeSingle();
    if (!appointment) {
      redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('El turno seleccionado no es válido')}`);
    }
  }

  const { error } = await supabase.from('patient_follow_ups').insert({
    tenant_id: tenantId,
    professional_id: user.id,
    patient_id: parsed.data.patientId,
    appointment_id: parsed.data.appointmentId ?? null,
    source_type: parsed.data.appointmentId ? 'manual_session' : 'manual_follow_up',
    voice_note_id: null,
    content: parsed.data.content,
  });

  if (error) {
    redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('No se pudo guardar la nota')}`);
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}?success=followup`);
}

// Ficha clínica: información general y relativamente estable del paciente.
// Se edita directamente acá (upsert por patient_id + tenant_id) — a
// diferencia de antes, NO depende de que existan seguimientos cargados.
export async function upsertPatientRecord(formData: FormData) {
  const optional = z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(10000).nullable().optional(),
  );

  const parsed = z.object({
    patientId: z.string().uuid(),
    reason: optional,
    background: optional,
    diagnosis: optional,
    plan: optional,
    notes: optional,
  }).safeParse({
    patientId: formData.get('patientId'),
    reason: formData.get('reason'),
    background: formData.get('background'),
    diagnosis: formData.get('diagnosis'),
    plan: formData.get('plan'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Ficha%20cl%C3%ADnica%20inv%C3%A1lida');
  }

  const { supabase, tenantId } = await requireTenant();
  const { data: patient } = await supabase
    .from('patients')
    .select('id')
    .eq('id', parsed.data.patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!patient) {
    redirect('/patients?error=Paciente%20no%20disponible');
  }

  // `patient_records_patient_id_key` (UNIQUE (patient_id)) ya existe en la
  // base real, así que se usa un `upsert` real sobre esa constraint en vez
  // del select→update/insert manual anterior — evita la condición de
  // carrera entre el select y el insert (dos guardados simultáneos ya no
  // pueden crear dos registros para el mismo paciente). `patient_id`
  // pertenece a un solo paciente que ya validamos arriba que es de este
  // tenant, así que no hace falta volver a filtrar por tenant_id acá; sí
  // se sigue mandando `tenant_id` en el payload para que quede correcto en
  // el registro (tanto en el insert como en el update que dispare el
  // upsert) y para no debilitar la tenant isolation de los datos guardados.
  const { error } = await supabase.from('patient_records').upsert(
    {
      tenant_id: tenantId,
      patient_id: parsed.data.patientId,
      reason: parsed.data.reason ?? null,
      background: parsed.data.background ?? null,
      diagnosis: parsed.data.diagnosis ?? null,
      plan: parsed.data.plan ?? null,
      notes: parsed.data.notes ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'patient_id' },
  );

  if (error) {
    redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('No se pudo guardar la ficha clínica')}`);
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}?success=record`);
}
