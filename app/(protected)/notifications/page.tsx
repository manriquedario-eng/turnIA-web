import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { MarkNotificationsRead } from '@/components/notifications/MarkNotificationsRead';
import { EmptyState } from '@/components/ui/EmptyState';

const TZ = 'America/Argentina/Buenos_Aires';

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export default async function NotificationsPage() {
  const { supabase, user, tenantId } = await requireTenant();

  const { data: alerts, error } = await supabase
    .from('appointment_action_alerts')
    .select('id,action,created_at,read_at,appointment_id,patient_id')
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = error ? [] : alerts ?? [];
  const appointmentIds = [...new Set(rows.map((row) => row.appointment_id).filter(Boolean))];
  const patientIds = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))];

  const [appointmentsResult, patientsResult] = await Promise.all([
    appointmentIds.length
      ? supabase
          .from('appointments')
          .select('id,starts_at')
          .eq('tenant_id', tenantId)
          .in('id', appointmentIds)
      : Promise.resolve({ data: [] as { id: string; starts_at: string }[] }),
    patientIds.length
      ? supabase
          .from('patients')
          .select('id,name,alias,use_alias_for_communications')
          .eq('tenant_id', tenantId)
          .in('id', patientIds)
      : Promise.resolve({ data: [] as { id: string; name: string; alias: string | null; use_alias_for_communications: boolean | null }[] }),
  ]);

  const appointmentMap = new Map((appointmentsResult.data ?? []).map((row) => [row.id, row]));
  const patientMap = new Map((patientsResult.data ?? []).map((row) => [row.id, row]));

  function patientName(patientId: string | null) {
    if (!patientId) return 'Paciente';
    const patient = patientMap.get(patientId);
    if (!patient) return 'Paciente';
    if (patient.use_alias_for_communications && patient.alias?.trim()) return patient.alias.trim();
    return patient.name || 'Paciente';
  }

  return (
    <section className="stack">
      <MarkNotificationsRead />

      <div className="page-header">
        <div>
          <h1>Notificaciones</h1>
          <p className="muted">Historial de acciones realizadas por tus pacientes sobre sus turnos.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No hay notificaciones todavía"
          description="Cuando un paciente confirme, cancele o pida reprogramar un turno, va a quedar registrado acá."
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="stack" style={{ gap: 0 }}>
            {rows.map((alert) => {
              const patient = patientName(alert.patient_id);
              const appointment = appointmentMap.get(alert.appointment_id);
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
              const stateClass =
                alert.action === 'confirm'
                  ? 'is-confirm'
                  : alert.action === 'cancel'
                    ? 'is-cancel'
                    : 'is-reschedule';
              const href = appointment?.starts_at
                ? `/agenda?view=day&date=${dateKeyInTz(appointment.starts_at)}&edit=${alert.appointment_id}#turno-drawer`
                : '/agenda';

              return (
                <Link
                  key={alert.id}
                  href={href}
                  className={`notification-history-row ${stateClass} ${alert.read_at ? '' : 'is-unread'}`}
                >
                  <span className="notification-history-dot" aria-hidden="true" />
                  <span className="notification-history-copy">
                    <span className="notification-history-title">{title}</span>
                    <span className="notification-history-text">{text}</span>
                    <span className="notification-history-time">{formatWhen(alert.created_at)}</span>
                  </span>
                  <span className="timeline-item-chevron" aria-hidden="true">›</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
