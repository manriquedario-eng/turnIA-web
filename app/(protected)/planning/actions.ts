'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { assertNoOverlap, assertNotInPast } from '@/lib/appointments/scheduling';

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

function waitlistReturnTo(formData: FormData) {
  return formData.get('return_to') === '/waitlist' ? '/waitlist' : '/planning';
}

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

  try {
    assertNotInPast(startsAt);
  } catch (err) {
    redirect(`/planning?error=${encodeURIComponent(err instanceof Error ? err.message : 'La primera fecha debe ser futura')}`);
  }

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

  // PARTE 2 (bug crítico), extendido a turnos recurrentes: cada ocurrencia
  // se valida contra turnos activos existentes Y contra las ocurrencias
  // anteriores de esta misma serie (para no crear una serie que se
  // superpone consigo misma, p. ej. una frecuencia mal elegida con una
  // duración larga). Se valida TODA la serie antes de insertar nada — o se
  // crea completa, o no se crea ninguna ocurrencia.
  for (let i = 0; i < rows.length; i += 1) {
    const candidate = rows[i];
    try {
      assertNotInPast(candidate.starts_at);
      await assertNoOverlap(supabase, {
        tenantId,
        professionalId: user.id,
        startsAtIso: candidate.starts_at,
        endsAtIso: candidate.ends_at,
      });
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : 'No se pudo validar el horario';
      redirect(`/planning?error=${encodeURIComponent(`Turno ${i + 1} de ${rows.length}: ${baseMessage}`)}`);
    }
    const overlapsEarlierOccurrence = rows.slice(0, i).some((other) => other.starts_at < candidate.ends_at && other.ends_at > candidate.starts_at);
    if (overlapsEarlierOccurrence) {
      redirect(`/planning?error=${encodeURIComponent(`Turno ${i + 1} de ${rows.length} se superpone con otra ocurrencia de la misma serie.`)}`);
    }
  }

  const { error } = await supabase.from('appointments').insert(rows);
  if (error) redirect(`/planning?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  revalidatePath('/planning');
  redirect(`/planning?ok=${parsed.data.occurrences}%20turnos%20recurrentes%20creados`);
}

export async function addWaitlistEntry(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = waitlistReturnTo(formData);
  const parsed = waitlistSchema.safeParse({
    patient_id: formData.get('patient_id'),
    service_id: formData.get('service_id') || undefined,
    preferred_day: formData.get('preferred_day') || undefined,
    preferred_time: formData.get('preferred_time') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) redirect(`${returnTo}?error=Datos%20de%20lista%20de%20espera%20inválidos`);

  const { data: patient } = await supabase.from('patients').select('id').eq('tenant_id', tenantId).eq('id', parsed.data.patient_id).is('deleted_at', null).maybeSingle();
  if (!patient) redirect(`${returnTo}?error=Paciente%20inválido`);
  if (parsed.data.service_id) {
    const { data: service } = await supabase.from('services').select('id').eq('tenant_id', tenantId).eq('id', parsed.data.service_id).maybeSingle();
    if (!service) redirect(`${returnTo}?error=Servicio%20inválido`);
  }

  const { error } = await supabase.from('waitlist_entries').insert({
    tenant_id: tenantId,
    patient_id: parsed.data.patient_id,
    service_id: parsed.data.service_id ?? null,
    preferred_day: parsed.data.preferred_day || null,
    preferred_time: parsed.data.preferred_time || null,
    notes: parsed.data.notes || null,
    status: 'waiting',
  });
  if (error) redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/planning');
  revalidatePath('/waitlist');
  redirect(`${returnTo}?ok=Paciente%20agregado%20a%20la%20lista%20de%20espera`);
}

export async function updateWaitlistStatus(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = waitlistReturnTo(formData);
  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = z.enum(['waiting', 'contacted', 'booked', 'cancelled']).safeParse(formData.get('status'));
  if (!id.success || !status.success) redirect(`${returnTo}?error=Entrada%20inválida`);

  const { error } = await supabase
    .from('waitlist_entries')
    .update({ status: status.data, updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('tenant_id', tenantId);
  if (error) redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/planning');
  revalidatePath('/waitlist');
  redirect(`${returnTo}?ok=Lista%20de%20espera%20actualizada`);
}
