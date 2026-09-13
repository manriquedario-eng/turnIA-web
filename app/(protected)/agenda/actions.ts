'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const appointmentSchema = z.object({
  id: z.string().uuid().optional(),
  patient_id: z.string().uuid(),
  service_id: z.string().uuid(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  modality: z.enum(['presencial', 'domicilio', 'online']),
  quoted_amount: z.coerce.number().nonnegative().optional(),
});

async function validateRelations(
  tenantId: string,
  patientId: string,
  serviceId: string,
) {
  const { supabase } = await requireTenant();

  const [{ data: patient, error: patientError }, { data: service, error: serviceError }] = await Promise.all([
    supabase
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('services')
      .select('id, duration_minutes, price, currency')
      .eq('id', serviceId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (patientError || !patient) throw new Error('Paciente inválido para este consultorio.');
  if (serviceError || !service) throw new Error('Servicio inválido para este consultorio.');

  return service;
}

function safeReturn(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/agenda');
  return returnTo.startsWith('/agenda') ? returnTo : '/agenda';
}

export async function createAppointment(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);

  const parsed = appointmentSchema.safeParse({
    patient_id: formData.get('patient_id'),
    service_id: formData.get('service_id'),
    starts_at: formData.get('starts_at'),
    ends_at: formData.get('ends_at'),
    modality: formData.get('modality'),
    quoted_amount: formData.get('quoted_amount') || undefined,
  });

  if (!parsed.success) redirect(`${returnTo}&error=Datos%20de%20turno%20inválidos`);

  const start = new Date(parsed.data.starts_at);
  const end = new Date(parsed.data.ends_at);
  if (end <= start) redirect(`${returnTo}&error=La%20hora%20de%20fin%20debe%20ser%20posterior`);
  if (start.getTime() < Date.now() - 60_000) redirect(`${returnTo}&error=No%20se%20pueden%20crear%20turnos%20en%20el%20pasado`);

  const service = await validateRelations(tenantId, parsed.data.patient_id, parsed.data.service_id);

  const { error } = await supabase.from('appointments').insert({
    tenant_id: tenantId,
    patient_id: parsed.data.patient_id,
    service_id: parsed.data.service_id,
    starts_at: parsed.data.starts_at,
    ends_at: parsed.data.ends_at,
    timezone: 'America/Argentina/Buenos_Aires',
    modality: parsed.data.modality,
    status: 'scheduled',
    quoted_amount: parsed.data.quoted_amount ?? service.price ?? null,
    currency: service.currency ?? 'ARS',
    professional_id: user.id,
  });

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  redirect(`${returnTo}&ok=Turno%20creado`);
}

export async function updateAppointment(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);

  const parsed = appointmentSchema.safeParse({
    id: formData.get('id'),
    patient_id: formData.get('patient_id'),
    service_id: formData.get('service_id'),
    starts_at: formData.get('starts_at'),
    ends_at: formData.get('ends_at'),
    modality: formData.get('modality'),
    quoted_amount: formData.get('quoted_amount') || undefined,
  });

  if (!parsed.success || !parsed.data.id) redirect(`${returnTo}&error=Datos%20de%20turno%20inválidos`);

  const start = new Date(parsed.data.starts_at);
  const end = new Date(parsed.data.ends_at);
  if (end <= start) redirect(`${returnTo}&error=La%20hora%20de%20fin%20debe%20ser%20posterior`);

  await validateRelations(tenantId, parsed.data.patient_id, parsed.data.service_id);

  const { data: existing, error: existingError } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existingError || !existing) redirect(`${returnTo}&error=Turno%20no%20encontrado`);
  if (existing.status === 'cancelled' || existing.status === 'cancelado') {
    redirect(`${returnTo}&error=No%20se%20puede%20editar%20un%20turno%20cancelado`);
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      patient_id: parsed.data.patient_id,
      service_id: parsed.data.service_id,
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at,
      modality: parsed.data.modality,
      quoted_amount: parsed.data.quoted_amount ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId);

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  redirect(`${returnTo}&ok=Turno%20actualizado`);
}

export async function cancelAppointment(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect(`${returnTo}&error=Turno%20inválido`);

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('tenant_id', tenantId);

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  redirect(`${returnTo}&ok=Turno%20cancelado`);
}
