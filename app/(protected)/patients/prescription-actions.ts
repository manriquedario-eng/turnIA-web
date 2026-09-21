'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

const draftSchema = z.object({
  patientId: z.string().uuid(),
  diagnosis: optionalText(500),
  cie10: optionalText(20),
  observations: optionalText(4000),
  longTermTreatment: z.preprocess(
    (value) => value === 'on' || value === 'true' || value === true,
    z.boolean(),
  ),
});

export async function createPrescriptionDraft(formData: FormData) {
  const parsed = draftSchema.safeParse({
    patientId: formData.get('patientId'),
    diagnosis: formData.get('diagnosis'),
    cie10: formData.get('cie10'),
    observations: formData.get('observations'),
    longTermTreatment: formData.get('longTermTreatment'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Datos%20de%20receta%20inv%C3%A1lidos');
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

  const { data: prescription, error } = await supabase
    .from('prescriptions')
    .insert({
      tenant_id: tenantId,
      professional_id: user.id,
      patient_id: patient.id,
      provider: 'misrx',
      status: 'draft',
      diagnosis: parsed.data.diagnosis ?? null,
      cie10: parsed.data.cie10 ?? null,
      observations: parsed.data.observations ?? null,
      long_term_treatment: parsed.data.longTermTreatment,
      prescribed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !prescription) {
    console.error('[misrx] create draft failed', {
      code: error?.code,
      message: error?.message,
    });
    redirect(
      `/patients/${parsed.data.patientId}?error=${encodeURIComponent('No se pudo crear el borrador de receta')}#recetas`,
    );
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}?success=prescription-draft#recetas`);
}
