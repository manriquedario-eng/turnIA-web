'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';

function redirectWithError(message: string): never {
  redirect(`/reimbursements/new?error=${encodeURIComponent(message)}`);
}

function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const start = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month, 1));
  const end = new Date(next.getTime() - 86400000);

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    startsAt: start.toISOString(),
    nextMonthStartsAt: next.toISOString(),
  };
}

export async function createReimbursementCase(formData: FormData) {
  const patientId = String(formData.get('patient_id') ?? '').trim();
  const monthValue = String(formData.get('period_month') ?? '').trim();
  const serviceType = String(formData.get('service_type') ?? 'psychotherapy_individual').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!patientId) redirectWithError('Seleccioná un paciente.');
  const period = parseMonth(monthValue);
  if (!period) redirectWithError('Seleccioná un período válido.');

  const { supabase, tenantId, user } = await requireTenant();

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id,name,insurance_name,insurance_member_number,insurance_plan')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (patientError || !patient) redirectWithError('No se pudo encontrar el paciente.');
  if (!patient.insurance_name?.trim()) {
    redirectWithError('El paciente no tiene obra social o prepaga cargada. Completala primero en su ficha.');
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
    redirectWithError(`No se pudo crear el reintegro: ${reimbursementError?.message ?? 'error desconocido'}`);
  }

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id,status')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patient.id)
    .eq('professional_id', user.id)
    .gte('starts_at', period.startsAt)
    .lt('starts_at', period.nextMonthStartsAt);

  const linked = (appointments ?? []).filter((appointment: any) => {
    const normalized = String(appointment.status ?? '').toLowerCase();
    return !['cancelado', 'cancelled', 'canceled'].includes(normalized);
  });

  if (linked.length > 0) {
    const { error: linkError } = await supabase
      .from('reimbursement_case_appointments')
      .insert(
        linked.map((appointment: any) => ({
          tenant_id: tenantId,
          reimbursement_case_id: reimbursement.id,
          appointment_id: appointment.id,
        })),
      );

    if (linkError) {
      await supabase.from('reimbursement_cases').delete().eq('id', reimbursement.id).eq('tenant_id', tenantId);
      redirectWithError(`No se pudieron asociar las sesiones: ${linkError.message}`);
    }
  }

  revalidatePath('/reimbursements');
  revalidatePath(`/reimbursements/${reimbursement.id}`);
  redirect(`/reimbursements/${reimbursement.id}?created=1`);
}
