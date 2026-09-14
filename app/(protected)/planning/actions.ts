'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const recurringSchema = z.object({
  patient_id: z.string().uuid(),
  service_id: z.string().uuid(),
  starts_at_local: localDateTime,
  ends_at_local: localDateTime,
  modality: z.enum(['presencial', 'domicilio', 'online']),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  occurrences: z.coerce.number().int().min(2).max(24),
  quoted_amount: z.coerce.number().nonnegative().optional(),
});

const waitlistSchema = z.object({
  patient_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  preferred_day: z.string().trim().max(80).optional(),
  preferred_time: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

function toMendozaIso(local: string) {
  return new Date(`${local}:00-03:00`).toISOString();
}

function advanceIso(baseIso: string, index: number, frequency: 'weekly' | 'biweekly' | 'monthly') {
  const value = new Date(baseIso);
  if (frequency === 'weekly') value.setUTCDate(value.getUTCDate() + index * 7);
  if (frequency === 'biweekly') value.setUTCDate(value.getUTCDate() + index * 14);
  if (frequency === 'monthly') value.setUTCMonth(value.getUTCMonth() + index);
  return value.toISOString();
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

async function validatePatientAndService(tenantId: string, patientId: string, serviceId: string) {
  const { supabase } = await requireTenant();
  const [{ data: patient }, { data: service }] = await Promise.all([
    supabase.from('patients').select('id').eq('tenant_id', tenantId).eq('id', patientId).is('deleted_at', null).maybeSingle(),
    supabase.from('services').select('id, price, currency').eq('tenant_id', tenantId).eq('id', serviceId).maybeSingle(),
  ]);
  if (!patient) throw new Error('Paciente inválido para este consultorio.');
  if (!service) throw new Error('Servicio inválido para este consultorio.');
  return service;
}

export async function createRecurringAppointments(formData: FormData) {
  const { supabase, tenantId, user } = await requireTenant();
  const parsed = recurringSchema.safeParse({
    patient_id: formData.get('patient_id'),
    service_id: formData.get('service_id'),
    starts_at_local: formData.get('starts_at_local'),
    ends_at_local: formData.get('ends_at_local'),
    modality: formData.get('modality'),
    frequency: formData.get('frequency'),
    occurrences: formData.get('occurrences'),
    quoted_amount: formData.get('quoted_amount') || undefined,
  });
  if (!parsed.success) redirect('/planning?error=Datos%20de%20recurrencia%20inválidos');

  const startsAt = toMendozaIso(parsed.data.starts_at_local);
  const endsAt = toMendozaIso(parsed.data.ends_at_local);
  if (new Date(endsAt) <= new Date(startsAt)) redirect('/planning?error=La%20hora%20de%20fin%20debe%20ser%20posterior');
  if (new Date(startsAt).getTime() < Date.now() - 60_000) redirect('/planning?error=La%20primera%20fecha%20debe%20ser%20futura');

  const service = await validatePatientAndService(tenantId, parsed.data.patient_id, parsed.data.service_id);
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  const rows = Array.from({ length: parsed.data.occurrences }, (_, index) => {
    const occurrenceStart = advanceIso(startsAt, index, parsed.data.frequency);
    const occurrenceEnd = new Date(new Date(occurrenceStart).getTime() + durationMs).toISOString();
    return {
      tenant_id: tenantId,
      patient_id: parsed.data.patient_id,
      service_id: parsed.data.service_id,
      starts_at: occurrenceStart,
      ends_at: occurrenceEnd,
      timezone: 'America/Argentina/Buenos_Aires',
      modality: parsed.data.modality,
      status: 'scheduled',
      quoted_amount: parsed.data.quoted_amount ?? service.price ?? null,
      currency: service.currency ?? 'ARS',
      professional_id: user.id,
    };
  });

  const firstStart = rows[0]?.starts_at;
  const lastEnd = rows.at(-1)?.ends_at;
  if (!firstStart || !lastEnd) redirect('/planning?error=No%20se%20pudo%20generar%20la%20serie');

  const { data: existing, error: existingError } = await supabase
    .from('appointments')
    .select('id, starts_at, ends_at')
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .neq('status', 'cancelled')
    .lt('starts_at', lastEnd)
    .gt('ends_at', firstStart);
  if (existingError) redirect(`/planning?error=${encodeURIComponent(existingError.message)}`);

  const hasConflict = rows.some((candidate) =>
    (existing ?? []).some((current) => overlaps(candidate.starts_at, candidate.ends_at, current.starts_at, current.ends_at)),
  );
  if (hasConflict) redirect('/planning?error=La%20serie%20se%20superpone%20con%20uno%20o%20más%20turnos%20existentes');

  const { error } = await supabase.from('appointments').insert(rows);
  if (error) redirect(`/planning?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  revalidatePath('/planning');
  redirect(`/planning?ok=${parsed.data.occurrences}%20turnos%20recurrentes%20creados`);
}

export async function addWaitlistEntry(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const parsed = waitlistSchema.safeParse({
    patient_id: formData.get('patient_id'),
    service_id: formData.get('service_id') || undefined,
    preferred_day: formData.get('preferred_day') || undefined,
    preferred_time: formData.get('preferred_time') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) redirect('/planning?error=Datos%20de%20lista%20de%20espera%20inválidos');

  const { data: patient } = await supabase.from('patients').select('id').eq('tenant_id', tenantId).eq('id', parsed.data.patient_id).is('deleted_at', null).maybeSingle();
  if (!patient) redirect('/planning?error=Paciente%20inválido');
  if (parsed.data.service_id) {
    const { data: service } = await supabase.from('services').select('id').eq('tenant_id', tenantId).eq('id', parsed.data.service_id).maybeSingle();
    if (!service) redirect('/planning?error=Servicio%20inválido');
  }

  let duplicateQuery = supabase
    .from('waitlist_entries')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('patient_id', parsed.data.patient_id)
    .in('status', ['waiting', 'contacted']);
  duplicateQuery = parsed.data.service_id
    ? duplicateQuery.eq('service_id', parsed.data.service_id)
    : duplicateQuery.is('service_id', null);
  const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1).maybeSingle();
  if (duplicateError) redirect(`/planning?error=${encodeURIComponent(duplicateError.message)}`);
  if (duplicate) redirect('/planning?error=El%20paciente%20ya%20tiene%20una%20entrada%20activa%20equivalente');

  const { error } = await supabase.from('waitlist_entries').insert({
    tenant_id: tenantId,
    patient_id: parsed.data.patient_id,
    service_id: parsed.data.service_id ?? null,
    preferred_day: parsed.data.preferred_day || null,
    preferred_time: parsed.data.preferred_time || null,
    notes: parsed.data.notes || null,
    status: 'waiting',
  });
  if (error) redirect(`/planning?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/planning');
  redirect('/planning?ok=Paciente%20agregado%20a%20la%20lista%20de%20espera');
}

export async function updateWaitlistStatus(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = z.enum(['waiting', 'contacted', 'booked', 'cancelled']).safeParse(formData.get('status'));
  if (!id.success || !status.success) redirect('/planning?error=Entrada%20inválida');

  const { error } = await supabase
    .from('waitlist_entries')
    .update({ status: status.data, updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('tenant_id', tenantId);
  if (error) redirect(`/planning?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/planning');
  redirect('/planning?ok=Lista%20de%20espera%20actualizada');
}
