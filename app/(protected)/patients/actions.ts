'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(160).nullable().optional()
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
  });
}

export async function createPatient(formData: FormData) {
  const parsed = formDataToPatient(formData);
  if (!parsed.success) {
    redirect(`/patients?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Datos inválidos')}`);
  }

  const { supabase, tenantId } = await requireTenant();
  const { id: _id, ...payload } = parsed.data;
  const { error } = await supabase.from('patients').insert({
    tenant_id: tenantId,
    ...payload,
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
  const { data, error } = await supabase
    .from('patients')
    .update({ ...payload, updated_at: new Date().toISOString() })
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
