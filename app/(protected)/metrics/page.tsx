import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { EmptyState } from '@/components/ui/EmptyState';

const CANCELLED = new Set(['cancelled', 'cancelado']);
const NO_SHOW = new Set(['no_show', 'no-show', 'ausente']);

export default async function MetricsPage() {
  const { supabase, tenantId } = await requireTenant();

  const [appointmentsResult, paymentsResult] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, patient_id, starts_at, status, quoted_amount, currency, patients(name)')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('payments')
      .select('appointment_id, amount')
      .eq('tenant_id', tenantId),
  ]);

  const appointments = appointmentsResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const paidByAppointment = new Map<string, number>();
  for (const payment of payments) {
    paidByAppointment.set(payment.appointment_id, (paidByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0));
  }

  const collectible = appointments.filter((a) => !CANCELLED.has(a.status ?? ''));
  const debts = collectible
    .map((appointment) => {
      const quoted = Number(appointment.quoted_amount ?? 0);
      const paid = paidByAppointment.get(appointment.id) ?? 0;
      return { ...appointment, quoted, paid, balance: Math.max(quoted - paid, 0) };
    })
    .filter((row) => row.balance > 0);

  const totalQuoted = collectible.reduce((sum, row) => sum + Number(row.quoted_amount ?? 0), 0);
  const totalPaid = payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const totalDebt = debts.reduce((sum, row) => sum + row.balance, 0);
  const noShows = appointments.filter((row) => NO_SHOW.has(row.status ?? '')).length;
  const cancelled = appointments.filter((row) => CANCELLED.has(row.status ?? '')).length;
  const attendanceBase = Math.max(appointments.length - cancelled, 0);
  const noShowRate = attendanceBase > 0 ? (noShows / attendanceBase) * 100 : 0;
  const collectionRate = totalQuoted > 0 ? Math.min((totalPaid / totalQuoted) * 100, 100) : 0;

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Deudas y métricas</h1>
          <p className="muted">Visión simple de cobranzas y comportamiento de turnos, calculada con los datos registrados en TurnIA.</p>
        </div>
      </div>

      {/* Rediseño: antes las 4 métricas eran un .stat-strip parejo, sin
          indicar que "Pendiente actual" es la cifra que más importa acá —
          ahora es una card propia (hero) con acento de color según haya o
          no deuda, y las otras 3 quedan como franja secundaria más chica.
          Mismos cálculos, ningún dato nuevo. */}
      <div className="metrics-hero-row">
        <div className={`metrics-hero-card ${totalDebt > 0 ? 'has-debt' : ''}`}>
          <span className="patient-meta-label">Pendiente actual</span>
          <span className="metrics-hero-value">${totalDebt.toLocaleString('es-AR')}</span>
          <span className="stat-strip-hint">{debts.length} turno{debts.length === 1 ? '' : 's'} con saldo</span>
        </div>
        <div className="stat-strip metrics-secondary-strip">
          <div className="stat-strip-item">
            <span className="stat-strip-label">Cobrado registrado</span>
            <span className="stat-strip-value stat-strip-value-money">${totalPaid.toLocaleString('es-AR')}</span>
          </div>
          <div className="stat-strip-item">
            <span className="stat-strip-label">Tasa de cobranza</span>
            <span className="stat-strip-value">{collectionRate.toFixed(1)}%</span>
          </div>
          <div className="stat-strip-item">
            <span className="stat-strip-label">Ausentismo</span>
            <span className="stat-strip-value">{noShowRate.toFixed(1)}%</span>
            <span className="stat-strip-hint">{noShows} ausencias</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap', padding: '20px 20px 0' }}>
          <div><h2 style={{ marginTop: 0 }}>Saldos por cobrar</h2><p className="muted" style={{ marginTop: 0 }}>Turnos no cancelados cuyo importe registrado supera los pagos asociados.</p></div>
          <Link className="btn" href="/payments">Registrar cobro</Link>
        </div>
        {debts.length === 0 ? (
          <div style={{ padding: '0 20px 20px' }}>
            <EmptyState title="No hay saldos pendientes" description="Todos los turnos no cancelados están cobrados al día." />
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th>Paciente</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Importe</th><th style={{ textAlign: 'right' }}>Pagado</th><th style={{ textAlign: 'right' }}>Saldo</th></tr>
              </thead>
              <tbody>
                {debts.map((row: any) => (
                  <tr key={row.id}>
                    <td>{row.patients?.name ?? 'Sin paciente'}</td>
                    <td className="muted">{new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short' }).format(new Date(row.starts_at))}</td>
                    <td className="table-cell-amount muted">${row.quoted.toLocaleString('es-AR')}</td>
                    <td className="table-cell-amount muted">${row.paid.toLocaleString('es-AR')}</td>
                    <td className="table-cell-amount"><strong style={{ color: 'var(--color-warning)' }}>${row.balance.toLocaleString('es-AR')}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Lectura de actividad</h2>
        <div className="metrics-activity-row">
          <div className="metrics-activity-item">
            <span className="metrics-activity-value">{appointments.length}</span>
            <span className="patient-meta-label">Turnos registrados</span>
          </div>
          <div className="metrics-activity-item">
            <span className="metrics-activity-value">{cancelled}</span>
            <span className="patient-meta-label">Cancelados</span>
          </div>
          <div className="metrics-activity-item">
            <span className="metrics-activity-value">{noShows}</span>
            <span className="patient-meta-label">Ausencias</span>
          </div>
        </div>
        {noShows === 0 && <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>Actualmente no hay turnos con un estado de ausencia/no-show registrado; la métrica crecerá en utilidad cuando ese estado se utilice operativamente.</p>}
      </div>
    </section>
  );
}
