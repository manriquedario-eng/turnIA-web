import { requireTenant } from '@/lib/auth/require-user';
import { NotificationHistoryList } from '@/components/notifications/NotificationHistoryList';

const TZ = 'America/Argentina/Buenos_Aires';

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default async function NotificationsPage() {
  const { supabase, user, tenantId } = await requireTenant();

  const { data: alerts, error } = await supabase
    .from('appointment_action_alerts')
    .select('id,action,created_at,read_at,patient_id')
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = error ? [] : alerts ?? [];
  const patientIds = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))];

  const patientsResult = patientIds.length
    ? await supabase
        .from('patients')
        .select('id,name,alias,use_alias_for_communications')
        .eq('tenant_id', tenantId)
        .in('id', patientIds)
    : { data: [] as { id: string; name: string; alias: string | null; use_alias_for_communications: boolean | null }[] };

  const patientMap = new Map((patientsResult.data ?? []).map((row) => [row.id, row]));

  function patientName(patientId: string | null) {
    if (!patientId) return 'Paciente';
    const patient = patientMap.get(patientId);
    if (!patient) return 'Paciente';
    if (patient.use_alias_for_communications && patient.alias?.trim()) return patient.alias.trim();
    return patient.name || 'Paciente';
  }

  const items = rows.map((alert) => {
    const patient = patientName(alert.patient_id);
    const title =
      alert.action === 'confirm'
        ? 'Turno confirmado'
        : alert.action === 'cancel'
          ? 'Turno cancelado'
          : 'Solicitud de reprogramación';
    const text =
      alert.action === 'confirm'
        ? `${patient} confirmó su turno.`
        : alert.action === 'cancel'
          ? `${patient} canceló su turno.`
          : `${patient} pidió reprogramar su turno.`;

    return {
      id: alert.id,
      action: alert.action as 'confirm' | 'cancel' | 'reschedule',
      title,
      text,
      createdAtLabel: formatWhen(alert.created_at),
      read: Boolean(alert.read_at),
    };
  });

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Notificaciones</h1>
          <p className="muted">
            Historial de acciones realizadas por tus pacientes sobre sus turnos.
          </p>
        </div>
      </div>

      <NotificationHistoryList initialItems={items} />
    </section>
  );
}
