import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';

const CANCELLED = new Set(['cancelled', 'cancelado']);
const NO_SHOW = new Set(['no_show', 'no-show', 'ausente']);

function relationName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0] as { name?: string } | undefined;
    return first?.name ?? null;
  }
  if (typeof value === 'object' && 'name' in value) {
    return (value as { name?: string }).name ?? null;
  }
  return null;
}

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
    paidByAppointment.set(
      payment.appointment_id,
      (paidByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0),
    );
  }

  const collectible = appointments.filter((appointment) => !CANCELLED.has(appointment.status ?? ''));
  const debts = collectible
    .map((appointment) => {
      const quoted = Number(appointment.quoted_amount ?? 0);
      const paid = paidByAppointment.get(appointment.id) ?? 0;
      return {
        ...appointment,
        patientName: relationName(appointment.patients),
        quoted,
        paid,
        balance: Math.max(quoted - paid, 0),
      };
    })
    .filter((row) => row.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const now = Date.now();
  const overdueDebts = debts.filter((row) => new Date(row.starts_at).getTime() < now);
  const debtors = new Set(debts.map((row) => row.patient_id).filter(Boolean)).size;
  const totalQuoted = collectible.reduce((sum, row) => sum + Number(row.quoted_amount ?? 0), 0);
  const totalPaid = payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const totalDebt = debts.reduce((sum, row) => sum + row.balance, 0);
  const overdueDebt = overdueDebts.reduce((sum, row) => sum + row.balance, 0);
  const noShows = appointments.filter((row) => NO_SHOW.has(row.status ?? '')).length;
  const cancelled = appointments.filter((row) => CANCELLED.has(row.status ?? '')).length;
  const attendanceBase = Math.max(appointments.length - cancelled, 0);
  const noShowRate = attendanceBase > 0 ? (noShows / attendanceBase) * 100 : 0;
  const collectionRate = totalQuoted > 0 ? Math.min((totalPaid / totalQuoted) * 100, 100) : 0;

  const money = (value: number) => `$${value.toLocaleString('es-AR')}`;
  const shortDate = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
  });

  return (
    <section className="stack">
      <div>
        <h1>Deudas y métricas</h1>
        <p className="muted">Visión simple de cobranzas y comportamiento de turnos, calculada sólo con datos del tenant activo.</p>
      </div>

      <div className="grid">
        <div className="card">
          <div className="muted">Saldo pendiente</div>
          <strong style={{ fontSize: 28 }}>{money(totalDebt)}</strong>
          <div className="muted">{debtors} paciente{debtors === 1 ? '' : 's'} con saldo</div>
        </div>
        <div className="card">
          <div className="muted">Deuda vencida</div>
          <strong style={{ fontSize: 28 }}>{money(overdueDebt)}</strong>
          <div className="muted">{overdueDebts.length} turno{overdueDebts.length === 1 ? '' : 's'} ya ocurrido{overdueDebts.length === 1 ? '' : 's'}</div>
        </div>
        <div className="card">
          <div className="muted">Cobrado registrado</div>
          <strong style={{ fontSize: 28 }}>{money(totalPaid)}</strong>
          <div className="muted">Tasa de cobranza {collectionRate.toFixed(1)}%</div>
        </div>
        <div className="card">
          <div className="muted">Ausentismo registrado</div>
          <strong style={{ fontSize: 28 }}>{noShowRate.toFixed(1)}%</strong>
          <div className="muted">{noShows} ausencias</div>
        </div>
      </div>

      <div className="card">
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginTop: 0 }}>Saldos por cobrar</h2>
            <p className="muted">Turnos no cancelados cuyo importe registrado supera los pagos asociados.</p>
          </div>
          <Link className="btn" href="/payments">Registrar cobro</Link>
        </div>

        {debts.length === 0 ? (
          <p className="muted">No hay saldos pendientes calculables.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Paciente</th><th>Fecha</th><th>Importe</th><th>Pagado</th><th>Saldo</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {debts.map((row) => {
                  const overdue = new Date(row.starts_at).getTime() < now;
                  return (
                    <tr key={row.id}>
                      <td>{row.patientName ?? 'Sin paciente'}</td>
                      <td>{shortDate.format(new Date(row.starts_at))}</td>
                      <td>{money(row.quoted)}</td>
                      <td>{money(row.paid)}</td>
                      <td><strong>{money(row.balance)}</strong></td>
                      <td>{overdue ? 'Vencido' : 'Pendiente'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Lectura de actividad</h2>
        <p><strong>{appointments.length}</strong> turnos registrados · <strong>{cancelled}</strong> cancelados · <strong>{noShows}</strong> ausencias identificadas.</p>
        {noShows === 0 && (
          <p className="muted">Actualmente no hay turnos con un estado de ausencia/no-show registrado; la métrica crecerá en utilidad cuando ese estado se utilice operativamente.</p>
        )}
      </div>
    </section>
  );
}
