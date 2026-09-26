import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { resolvePatientCommunicationName } from '@/lib/patients/communication-name';

export const dynamic = 'force-dynamic';

const TZ = 'America/Argentina/Buenos_Aires';

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export async function GET() {
  const { supabase, user, tenantId } = await requireTenant();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: alerts, error } = await supabase
    .from('appointment_action_alerts')
    .select('id,action,created_at,appointment_id,patient_id,read_at')
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .is('read_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ alerts: [] }, { status: 500 });
  }

  const appointmentIds = Array.from(
    new Set((alerts ?? []).map((row) => row.appointment_id).filter(Boolean)),
  );
  const patientIds = Array.from(
    new Set((alerts ?? []).map((row) => row.patient_id).filter(Boolean)),
  );

  const [appointmentsResult, patientsResult] = await Promise.all([
    appointmentIds.length > 0
      ? supabase
          .from('appointments')
          .select('id,starts_at')
          .eq('tenant_id', tenantId)
          .in('id', appointmentIds)
      : Promise.resolve({ data: [], error: null }),
    patientIds.length > 0
      ? supabase
          .from('patients')
          .select('id,name,alias,use_alias_for_communications')
          .eq('tenant_id', tenantId)
          .in('id', patientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (appointmentsResult.error || patientsResult.error) {
    return NextResponse.json({ alerts: [] }, { status: 500 });
  }

  const appointmentMap = new Map(
    (appointmentsResult.data ?? []).map((row) => [row.id, row]),
  );
  const patientMap = new Map(
    (patientsResult.data ?? []).map((row) => [row.id, row]),
  );

  const response = (alerts ?? []).map((alert) => {
    const appointment = appointmentMap.get(alert.appointment_id);
    const patient = alert.patient_id ? patientMap.get(alert.patient_id) : null;
    const patientName = patient
      ? resolvePatientCommunicationName(patient)
      : 'Paciente';

    const title =
      alert.action === 'confirm'
        ? 'Turno confirmado'
        : alert.action === 'cancel'
          ? 'Turno cancelado'
          : 'Solicitud de reprogramación';

    const description =
      alert.action === 'confirm'
        ? `${patientName} confirmó su turno.`
        : alert.action === 'cancel'
          ? `${patientName} canceló su turno.`
          : `${patientName} pidió reprogramar su turno.`;

    const href = appointment?.starts_at
      ? `/agenda?view=day&date=${dateKeyInTz(appointment.starts_at)}&edit=${alert.appointment_id}#turno-drawer`
      : '/agenda';

    return {
      id: alert.id,
      action: alert.action,
      title,
      description,
      created_at: alert.created_at,
      href,
    };
  });

  return NextResponse.json(
    { alerts: response, unreadCount: response.length },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
