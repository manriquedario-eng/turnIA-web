import { requireTenant } from '@/lib/auth/require-user';
import { registerCashMovement, registerPayment } from './actions';
import { EmptyState } from '@/components/ui/EmptyState';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { supabase, tenantId } = await requireTenant();
  const params = await searchParams;

  const [{ data: appointments }, { data: payments }, { data: cashMovements }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, quoted_amount, currency, patients(name)')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false })
      .limit(50),
    supabase
      .from('payments')
      .select('id, amount, currency, method, created_at, patient_id, appointment_id, patients(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('cash_movements')
      .select('id, amount, method, kind, created_at, payment_id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const balance = (cashMovements || []).reduce((sum, item) => {
    const amount = Number(item.amount || 0);
    return sum + (item.kind === 'in' ? amount : -amount);
  }, 0);

  const collected = (payments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Pagos y caja</h1>
          <p className="muted">Registrá cobros de turnos y movimientos manuales de caja.</p>
        </div>
      </div>

      {params.ok ? <p className="alert success">{params.ok}</p> : null}
      {params.error ? <p className="alert error">{params.error}</p> : null}

      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="stat-strip-label">Caja actual</span>
          <span className="stat-strip-value">${balance.toLocaleString('es-AR')}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Cobrado</span>
          <span className="stat-strip-value">${collected.toLocaleString('es-AR')}</span>
          <span className="stat-strip-hint">últimos 50 pagos</span>
        </div>
      </div>

      <div className="split-main-side">
        <div className="stack">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Registrar pago</h2>
            <form action={registerPayment} className="form-grid">
              <label>Turno
                <select name="appointment_id" required defaultValue="">
                  <option value="" disabled>Seleccionar turno</option>
                  {(appointments || []).map((appointment: any) => (
                    <option key={appointment.id} value={appointment.id}>
                      {new Date(appointment.starts_at).toLocaleString('es-AR')} · {appointment.patients?.name || 'Sin paciente'} · ${Number(appointment.quoted_amount || 0).toLocaleString('es-AR')}
                    </option>
                  ))}
                </select>
              </label>
              <label>Importe
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </label>
              <label>Medio
                <select name="method" defaultValue="efectivo">
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
              <input name="idempotency_key" type="hidden" value={`payment-${crypto.randomUUID()}`} />
              <div className="form-actions">
                <button className="btn" type="submit">Registrar pago</button>
              </div>
            </form>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Movimiento manual de caja</h2>
            <form action={registerCashMovement} className="form-grid">
              <label>Tipo
                <select name="kind" defaultValue="out">
                  <option value="in">Ingreso</option>
                  <option value="out">Egreso</option>
                </select>
              </label>
              <label>Importe
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </label>
              <label>Medio / concepto breve
                <input name="method" maxLength={60} required placeholder="efectivo, transferencia, insumo..." />
              </label>
              <div className="form-actions">
                <button className="btn secondary" type="submit">Registrar movimiento</button>
              </div>
            </form>
          </section>
        </div>

        <div className="stack">
          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <h2 style={{ margin: '18px 20px 0' }}>Últimos pagos</h2>
            {(payments || []).length === 0 ? (
              <div style={{ padding: '0 20px 20px' }}>
                <EmptyState title="Sin pagos registrados" description="Los pagos que registres van a aparecer acá." />
              </div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 12, paddingBottom: 8 }}>
                <table className="table">
                  <thead>
                    <tr><th>Fecha</th><th>Paciente</th><th>Medio</th><th>Importe</th></tr>
                  </thead>
                  <tbody>
                    {(payments || []).map((payment: any) => (
                      <tr key={payment.id}>
                        <td className="muted">{new Date(payment.created_at).toLocaleString('es-AR')}</td>
                        <td>{payment.patients?.name ?? 'Sin paciente'}</td>
                        <td className="muted" style={{ textTransform: 'capitalize' }}>{payment.method}</td>
                        <td><strong>${Number(payment.amount).toLocaleString('es-AR')} {payment.currency}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Últimos movimientos de caja</h2>
            {(cashMovements || []).length === 0 ? (
              <EmptyState title="Sin movimientos" description="Los movimientos manuales de caja van a aparecer acá." />
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {(cashMovements || []).map((movement: any) => (
                  <div key={movement.id} className="nav" style={{ justifyContent: 'space-between', fontSize: 13, paddingBottom: 8, borderBottom: '1px solid var(--color-border-soft)' }}>
                    <strong style={{ color: movement.kind === 'in' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {movement.kind === 'in' ? '+' : '-'}${Number(movement.amount).toLocaleString('es-AR')}
                    </strong>
                    <span className="muted">{movement.method} · {new Date(movement.created_at).toLocaleString('es-AR')}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
