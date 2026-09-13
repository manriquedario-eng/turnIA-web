'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { normalizePhone } from '@/lib/phone';

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
  const phoneNormalization = normalizePhone(payload.phone ?? null);
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
  const phoneNormalization = normalizePhone(payload.phone ?? null);

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

export async function createManualFollowUp(formData: FormData) {
  const parsed = z.object({
    patientId: z.string().uuid(),
    content: z.string().trim().min(2, 'El seguimiento no puede estar vacío').max(10000),
  }).safeParse({
    patientId: formData.get('patientId'),
    content: formData.get('content'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Seguimiento%20inválido');
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

  const { error } = await supabase.from('patient_follow_ups').insert({
    tenant_id: tenantId,
    professional_id: user.id,
    patient_id: parsed.data.patientId,
    appointment_id: null,
    source_type: 'manual_text',
    voice_note_id: null,
    content: parsed.data.content,
  });

  if (error) {
    redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('No se pudo guardar el seguimiento')}`);
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}?success=followup`);
}
