import 'server-only';

import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';

export type AppointmentActionAlertAction = 'confirm' | 'cancel' | 'reschedule';

export async function createAppointmentActionAlertByToken(
  token: string,
  action: AppointmentActionAlertAction,
): Promise<void> {
  if (!isServiceRoleConfigured()) return;

  const supabase = createSupabaseServiceClient();
  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id,tenant_id,patient_id,professional_id,starts_at,reschedule_requested_at')
    .eq('public_token', token)
    .maybeSingle();

  if (error || !appointment?.id || !appointment.tenant_id || !appointment.professional_id) {
    return;
  }

  const cycle =
    action === 'reschedule'
      ? appointment.reschedule_requested_at ?? appointment.starts_at
      : appointment.starts_at;

  const dedupeKey = `appointment_action:${action}:${appointment.id}:${cycle}`;

  const { error: insertError } = await supabase
    .from('appointment_action_alerts')
    .insert({
      tenant_id: appointment.tenant_id,
      professional_id: appointment.professional_id,
      appointment_id: appointment.id,
      patient_id: appointment.patient_id ?? null,
      action,
      dedupe_key: dedupeKey,
    });

  if (insertError && insertError.code !== '23505') {
    console.error('Appointment action alert insert failed', {
      appointmentId: appointment.id,
      action,
      code: insertError.code,
    });
  }
}
