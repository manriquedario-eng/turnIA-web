'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function redirectWithError(message: string, context?: { patientId?: string; periodStart?: string; periodEnd?: string }): never {
  const params = new URLSearchParams({ error: message });
  if (context?.patientId) params.set('patient', context.patientId);
  if (context?.periodStart) params.set('period_start', context.periodStart);
  if (context?.periodEnd) params.set('period_end', context.periodEnd);
  redirect(`/reimbursements/new?${params.toString()}`);
}

function dateRange(valueStart: string, valueEnd: string) {
  if (!DATE_RE.test(valueStart) || !DATE_RE.test(valueEnd)) return null;

  const start = new Date(`${valueStart}T00:00:00-03:00`);
  const end = new Date(`${valueEnd}T23:59:59.999-03:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;

  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (spanDays > 366) return null;

  return {
    periodStart: valueStart,
    periodEnd: valueEnd,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

export async function createReimbursementCase(formData: FormData) {
  const patientId = String(formData.get('patient_id') ?? '').trim();
  const periodStart = String(formData.get('period_start') ?? '').trim();
  const periodEnd = String(formData.get('period_end') ?? '').trim();
  const appointmentIds = Array.from(
    new Set(formData.getAll('appointment_ids').map((value) => String(value).trim()).filter(Boolean)),
  );
  const serviceType = String(formData.get('service_type') ?? 'psychotherapy_individual').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const context = { patientId, periodStart, periodEnd };

  if (!patientId) redirectWithError('Seleccioná un paciente.', context);
  const period = dateRange(periodStart, periodEnd);
  if (!period) redirectWithError('Seleccioná un rango de fechas válido.', context);
  if (appointmentIds.length === 0) redirectWithError('Seleccioná al menos una sesión para incluir en el reintegro.', context);

  const { supabase, tenantId, user } = await requireTenant();

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id,name,insurance_name,insurance_member_number,insurance_plan')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (patientError || !patient) redirectWithError('No se pudo encontrar el paciente.', context);
  if (!patient.insurance_name?.trim()) {
    redirectWithError('El paciente no tiene obra social o prepaga cargada. Completala primero en su ficha.', context);
  }

  const { data: selectedAppointments, error: appointmentsError } = await supabase
    .from('appointments')
    .select('id,status,starts_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patient.id)
    .eq('professional_id', user.id)
    .gte('starts_at', period.startsAt)
    .lte('starts_at', period.endsAt)
    .in('id', appointmentIds);

  if (appointmentsError) redirectWithError('No se pudieron validar las sesiones seleccionadas.', context);

  const validAppointments = (selectedAppointments ?? []).filter((appointment: any) => {
    const normalized = String(appointment.status ?? '').toLowerCase();
    return !['cancelado', 'cancelled', 'canceled'].includes(normalized);
  });

  if (validAppointments.length !== appointmentIds.length) {
    redirectWithError('Una o más sesiones seleccionadas ya no están disponibles para este reintegro. Revisá la selección.', context);
  }

  const { data: reimbursement, error: reimbursementError } = await supabase
    .from('reimbursement_cases')
    .insert({
      tenant_id: tenantId,
      professional_id: user.id,
      patient_id: patient.id,
      coverage_name: patient.insurance_name.trim(),
      coverage_plan: patient.insurance_plan?.trim() || null,
      member_number: patient.insurance_member_number?.trim() || null,
      service_type: serviceType || 'psychotherapy_individual',
      period_start: period.periodStart,
      period_end: period.periodEnd,
      notes: notes || null,
    })
    .select('id')
    .single();

  if (reimbursementError || !reimbursement) {
    redirectWithError(`No se pudo crear el reintegro: ${reimbursementError?.message ?? 'error desconocido'}`, context);
  }

  const { error: linkError } = await supabase
    .from('reimbursement_case_appointments')
    .insert(
      validAppointments.map((appointment: any) => ({
        tenant_id: tenantId,
        reimbursement_case_id: reimbursement.id,
        appointment_id: appointment.id,
      })),
    );

  if (linkError) {
    await supabase.from('reimbursement_cases').delete().eq('id', reimbursement.id).eq('tenant_id', tenantId);
    redirectWithError(`No se pudieron asociar las sesiones: ${linkError.message}`, context);
  }

  revalidatePath('/reimbursements');
  revalidatePath(`/reimbursements/${reimbursement.id}`);
  redirect(`/reimbursements/${reimbursement.id}?created=1`);
}
