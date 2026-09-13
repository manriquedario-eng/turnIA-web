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

function money(amount: number, currency = 'ARS') {
  return `${currency} ${amount.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

export default async function DashboardPage() {
  const { supabase, tenantId } = await requireTenant();
  const today = todayLocal();
  const { start, end } = dayRange(today);
  const now = new Date();

  const [patientsResult, appointmentsResult, paymentsTodayResult, cashResult] = await Promise.all([
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
  const appointmentIds = activeAppointments.map((item) => item.id);

  const appointmentPaymentsResult = appointmentIds.length > 0
    ? await supabase
      .from('payments')
      .select('appointment_id, amount')
      .eq('tenant_id', tenantId)
      .in('appointment_id', appointmentIds)
    : { data: [] as Array<{ appointment_id: string | null; amount: number | string | null }> };

  const paidByAppointment = new Map<string, number>();
  for (const payment of appointmentPaymentsResult.data ?? []) {
    if (!payment.appointment_id) continue;
    paidByAppointment.set(
      payment.appointment_id,
      (paidByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0),
    );
  }

  const pendingByAppointment = new Map<string, number>();
  let pendingToday = 0;
  for (const appointment of activeAppointments) {
    const quoted = Number(appointment.quoted_amount ?? 0);
    const paid = paidByAppointment.get(appointment.id) ?? 0;
    const pending = Math.max(quoted - paid, 0);
    pendingByAppointment.set(appointment.id, pending);
    pendingToday += pending;
  }

  const collectedToday = (paymentsTodayResult.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const cashToday = (cashResult.data ?? []).reduce((sum, row) => {
    const amount = Number(row.amount ?? 0);
    return sum + (row.kind === 'in' ? amount : -amount);
  }, 0);

  const nextAppointment = activeAppointments.find((item) => new Date(item.starts_at) >= now) ?? null;
  const unpaidAppointments = activeAppointments.filter((item) => (pendingByAppointment.get(item.id) ?? 0) > 0);
  const attentionCount = unpaidAppointments.length + cancelledAppointments.length;

  return (
    <section className="stack">
      <div>
        <h1>Hoy</h1>
        <p className="muted">Centro operativo del consultorio · {new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date())}</p>
      </div>

      <div className="grid">
        <div className="card">
          <div className="muted">Turnos programados</div>
          <strong style={{ fontSize: 28 }}>{activeAppointments.length}</strong>
        </div>
        <div className="card">
          <div className="muted">Cancelados hoy</div>
          <strong style={{ fontSize: 28 }}>{cancelledAppointments.length}</strong>
        </div>
        <div className="card">
          <div className="muted">Cobrado hoy</div>
          <strong style={{ fontSize: 28 }}>{money(collectedToday)}</strong>
        </div>
        <div className="card">
          <div className="muted">Pendiente de cobro hoy</div>
          <strong style={{ fontSize: 28 }}>{money(pendingToday)}</strong>
        </div>
      </div>

      <div className="grid">
        <section className="card stack">
          <div>
            <h2 style={{ marginTop: 0 }}>Próximo paciente</h2>
            <p className="muted">El siguiente turno activo de hoy.</p>
          </div>
          {nextAppointment ? (
            <div className="stack" style={{ gap: 8 }}>
              <strong style={{ fontSize: 22 }}>{formatTime(nextAppointment.starts_at)} · {nextAppointment.patients?.name ?? 'Sin paciente'}</strong>
              <span>{nextAppointment.services?.name ?? 'Sin servicio'} · {nextAppointment.modality}</span>
              <span className="muted">
                Monto: {money(Number(nextAppointment.quoted_amount ?? 0), nextAppointment.currency ?? 'ARS')} · Pendiente: {money(pendingByAppointment.get(nextAppointment.id) ?? 0, nextAppointment.currency ?? 'ARS')}
              </span>
              <div>
                <Link className="btn" href={`/agenda?view=day&date=${today}`}>Ver en agenda</Link>
              </div>
            </div>
          ) : (
            <p className="muted">No quedan turnos activos para hoy.</p>
          )}
        </section>

        <section className="card stack">
          <div>
            <h2 style={{ marginTop: 0 }}>Requiere atención</h2>
            <p className="muted">Pendientes de cobro y cancelaciones del día.</p>
          </div>
          <strong style={{ fontSize: 28 }}>{attentionCount}</strong>
          <div className="stack" style={{ gap: 6 }}>
            <span>{unpaidAppointments.length} turno(s) con saldo pendiente</span>
            <span>{cancelledAppointments.length} cancelación(es)</span>
          </div>
          <div className="nav" style={{ flexWrap: 'wrap' }}>
            <Link className="btn" href="/payments">Registrar cobro</Link>
            <Link className="btn secondary" href={`/agenda?view=day&date=${today}`}>Revisar agenda</Link>
          </div>
        </section>
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
                <tr><th>Hora</th><th>Paciente</th><th>Servicio</th><th>Modalidad</th><th>Estado</th><th>Monto</th><th>Pendiente</th></tr>
              </thead>
              <tbody>
                {appointments.map((appointment: any) => (
                  <tr key={appointment.id}>
                    <td><strong>{formatTime(appointment.starts_at)}</strong></td>
                    <td>{appointment.patients?.name ?? 'Sin paciente'}</td>
                    <td>{appointment.services?.name ?? 'Sin servicio'}</td>
                    <td>{appointment.modality}</td>
                    <td>{appointment.status}</td>
                    <td>{appointment.quoted_amount != null ? money(Number(appointment.quoted_amount), appointment.currency ?? 'ARS') : '—'}</td>
                    <td>{isCancelled(appointment.status) ? '—' : money(pendingByAppointment.get(appointment.id) ?? 0, appointment.currency ?? 'ARS')}</td>
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
          <Link className="btn secondary" href="/patients">Nuevo paciente / Pacientes</Link>
          <Link className="btn secondary" href="/payments">Registrar cobro</Link>
          <Link className="btn secondary" href="/services">Servicios</Link>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Movimiento neto de caja de hoy: {money(cashToday)}</p>
      </div>
    </section>
  );
}
