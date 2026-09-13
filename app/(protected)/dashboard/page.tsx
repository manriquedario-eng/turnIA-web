import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';

const TZ = 'America/Argentina/Buenos_Aires';

function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dayRange(date: string) {
  return {
    start: new Date(`${date}T00:00:00-03:00`).toISOString(),
    end: new Date(`${date}T23:59:59.999-03:00`).toISOString(),
  };
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

export default async function DashboardPage() {
  const { supabase, tenantId } = await requireTenant();
  const today = todayLocal();
  const { start, end } = dayRange(today);

  const [patientsResult, appointmentsResult, paymentsResult, cashResult] = await Promise.all([
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null),
    supabase
      .from('appointments')
      .select('id, patient_id, service_id, starts_at, ends_at, status, modality, quoted_amount, currency, patients(name), services(name)')
      .eq('tenant_id', tenantId)
      .gte('starts_at', start)
      .lte('starts_at', end)
      .order('starts_at', { ascending: true }),
    supabase
      .from('payments')
      .select('amount')
      .eq('tenant_id', tenantId)
      .gte('created_at', start)
      .lte('created_at', end),
    supabase
      .from('cash_movements')
      .select('amount, kind')
      .eq('tenant_id', tenantId)
      .gte('created_at', start)
      .lte('created_at', end),
  ]);

  const appointments = appointmentsResult.data ?? [];
  const activeAppointments = appointments.filter((item) => !isCancelled(item.status));
  const cancelledAppointments = appointments.filter((item) => isCancelled(item.status));
  const collectedToday = (paymentsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const cashToday = (cashResult.data ?? []).reduce((sum, row) => {
    const amount = Number(row.amount ?? 0);
    return sum + (row.kind === 'in' ? amount : -amount);
  }, 0);

  return (
    <section className="stack">
      <div>
        <h1>Hoy</h1>
        <p className="muted">Centro operativo del consultorio · {new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date())}</p>
      </div>

      <div className="grid">
        <div className="card">
          <div className="muted">Turnos de hoy</div>
          <strong style={{ fontSize: 28 }}>{activeAppointments.length}</strong>
        </div>
        <div className="card">
          <div className="muted">Cancelados hoy</div>
          <strong style={{ fontSize: 28 }}>{cancelledAppointments.length}</strong>
        </div>
        <div className="card">
          <div className="muted">Cobrado hoy</div>
          <strong style={{ fontSize: 28 }}>${collectedToday.toLocaleString('es-AR')}</strong>
        </div>
        <div className="card">
          <div className="muted">Movimiento neto de caja</div>
          <strong style={{ fontSize: 28 }}>${cashToday.toLocaleString('es-AR')}</strong>
        </div>
      </div>

      <div className="card">
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginTop: 0 }}>Agenda de hoy</h2>
            <p className="muted">{patientsResult.count ?? 0} pacientes activos en el consultorio.</p>
          </div>
          <div className="nav">
            <Link className="btn" href={`/agenda?view=day&date=${today}`}>Abrir agenda</Link>
            <Link className="btn secondary" href="/payments">Pagos y caja</Link>
          </div>
        </div>

        {appointments.length === 0 ? (
          <p className="muted">No hay turnos registrados para hoy.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Hora</th><th>Paciente</th><th>Servicio</th><th>Modalidad</th><th>Estado</th><th>Monto</th></tr>
              </thead>
              <tbody>
                {appointments.map((appointment: any) => (
                  <tr key={appointment.id}>
                    <td><strong>{formatTime(appointment.starts_at)}</strong></td>
                    <td>{appointment.patients?.name ?? 'Sin paciente'}</td>
                    <td>{appointment.services?.name ?? 'Sin servicio'}</td>
                    <td>{appointment.modality}</td>
                    <td>{appointment.status}</td>
                    <td>{appointment.quoted_amount != null ? `${appointment.currency ?? 'ARS'} ${Number(appointment.quoted_amount).toLocaleString('es-AR')}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Acciones rápidas</h2>
        <div className="nav" style={{ flexWrap: 'wrap' }}>
          <Link className="btn" href={`/agenda?view=day&date=${today}`}>Nuevo turno</Link>
          <Link className="btn secondary" href="/patients">Pacientes</Link>
          <Link className="btn secondary" href="/payments">Registrar cobro</Link>
          <Link className="btn secondary" href="/services">Servicios</Link>
        </div>
      </div>
    </section>
  );
}
