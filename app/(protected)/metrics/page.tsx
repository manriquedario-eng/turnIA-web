import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { StatCard } from '@/components/ui/StatCard';
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

      <div className="grid">
        <StatCard label="Saldo pendiente" value={`$${totalDebt.toLocaleString('es-AR')}`} />
        <StatCard label="Cobrado registrado" value={`$${totalPaid.toLocaleString('es-AR')}`} />
        <StatCard label="Tasa de cobranza" value={`${collectionRate.toFixed(1)}%`} />
        <StatCard label="Ausentismo registrado" value={`${noShowRate.toFixed(1)}%`} hint={`${noShows} ausencias`} />
      </div>

      <div className="card">
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div><h2 style={{ marginTop: 0 }}>Saldos por cobrar</h2><p className="muted">Turnos no cancelados cuyo importe registrado supera los pagos asociados.</p></div>
          <Link className="btn" href="/payments">Registrar cobro</Link>
        </div>
        {debts.length === 0 ? <EmptyState title="No hay saldos pendientes" description="Todos los turnos no cancelados están cobrados al día." /> : (
          <div style={{ overflowX: 'auto' }}><table className="table"><thead><tr><th>Paciente</th><th>Fecha</th><th>Importe</th><th>Pagado</th><th>Saldo</th></tr></thead><tbody>
            {debts.map((row: any) => <tr key={row.id}>
              <td>{row.patients?.name ?? 'Sin paciente'}</td>
              <td>{new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short' }).format(new Date(row.starts_at))}</td>
              <td>${row.quoted.toLocaleString('es-AR')}</td><td>${row.paid.toLocaleString('es-AR')}</td><td><strong>${row.balance.toLocaleString('es-AR')}</strong></td>
            </tr>)}
          </tbody></table></div>
        )}
      </div>

      <div className="card">
        <h2>Lectura de actividad</h2>
        <p><strong>{appointments.length}</strong> turnos registrados · <strong>{cancelled}</strong> cancelados · <strong>{noShows}</strong> ausencias identificadas.</p>
        {noShows === 0 && <p className="muted">Actualmente no hay turnos con un estado de ausencia/no-show registrado; la métrica crecerá en utilidad cuando ese estado se utilice operativamente.</p>}
      </div>
    </section>
  );
}
