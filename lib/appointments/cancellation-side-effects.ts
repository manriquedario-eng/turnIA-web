import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelGoogleMeetForAppointment } from '@/lib/google/calendar';
import { sendAppointmentCancellationEmail } from '@/lib/email/send-appointment-cancelled';
import { resolvePatientCommunicationName } from '@/lib/patients/communication-name';

const TZ = 'America/Argentina/Buenos_Aires';

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export type AppointmentCancellationSideEffectsInput = {
  supabase: SupabaseClient;
  tenantId: string;
  professionalUserId: string;
  appointmentId: string;
  patientId: string | null;
  startsAt: string;
  externalCalendarEventId: string | null;
};

export async function runAppointmentCancellationSideEffects(
  input: AppointmentCancellationSideEffectsInput,
): Promise<void> {
  // El turno ya debe estar cancelado cuando esta función se invoca.
  // Cada integración se aísla: ninguna puede revertir ni bloquear la cancelación.
  if (input.externalCalendarEventId) {
    try {
      const googleResult = await cancelGoogleMeetForAppointment({
        tenantId: input.tenantId,
        professionalUserId: input.professionalUserId,
        externalCalendarEventId: input.externalCalendarEventId,
      });

      if (googleResult.ok) {
        await input.supabase
          .from('appointments')
          .update({
            meeting_provider: null,
            meeting_url: null,
            external_calendar_event_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.appointmentId)
          .eq('tenant_id', input.tenantId)
          .eq('professional_id', input.professionalUserId);
      } else {
        console.error('[appointments] Google cancellation failed', {
          appointmentId: input.appointmentId,
          reason: googleResult.reason,
        });
      }
    } catch {
      console.error('[appointments] Google cancellation failed unexpectedly', {
        appointmentId: input.appointmentId,
      });
    }
  }

  if (!input.patientId) return;

  try {
    const [{ data: patient }, { data: profile }] = await Promise.all([
      input.supabase
        .from('patients')
        .select('name,alias,use_alias_for_communications,email')
        .eq('id', input.patientId)
        .eq('tenant_id', input.tenantId)
        .maybeSingle(),
      input.supabase
        .from('profiles')
        .select('display_name')
        .eq('id', input.professionalUserId)
        .maybeSingle(),
    ]);

    if (!patient) return;

    const result = await sendAppointmentCancellationEmail({
      supabase: input.supabase,
      tenantId: input.tenantId,
      patientId: input.patientId,
      appointmentId: input.appointmentId,
      patientEmail: patient.email ?? null,
      patientName: resolvePatientCommunicationName(patient),
      professionalName: profile?.display_name || 'tu profesional',
      dateLabel: dateLabel(input.startsAt),
      timeLabel: timeLabel(input.startsAt),
    });

    if (result.attempted && !result.ok) {
      console.error('[appointments] cancellation email failed', {
        appointmentId: input.appointmentId,
      });
    }
  } catch {
    console.error('[appointments] cancellation email failed unexpectedly', {
      appointmentId: input.appointmentId,
    });
  }
}
