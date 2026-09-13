import { requireTenant } from '@/lib/auth/require-user';
import { registerCashMovement, registerPayment } from './actions';

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
      .select('id, amount, currency, method, created_at, patient_id, appointment_id')
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

  return (
    <div className="stack">
      <div>
        <h1>Pagos y Caja</h1>
        <p className="muted">Registrá cobros de turnos y movimientos manuales de caja.</p>
      </div>

      {params.ok ? <div className="card">{params.ok}</div> : null}
      {params.error ? <div className="card">Error: {params.error}</div> : null}

      <div className="card">
        <strong>Saldo de caja actual: ${balance.toLocaleString('es-AR')}</strong>
      </div>

      <section className="card stack">
        <h2>Registrar pago</h2>
        <form action={registerPayment} className="stack">
          <label>
            Turno
            <select name="appointment_id" required defaultValue="">
              <option value="" disabled>Seleccionar turno</option>
              {(appointments || []).map((appointment: any) => (
                <option key={appointment.id} value={appointment.id}>
                  {new Date(appointment.starts_at).toLocaleString('es-AR')} · {appointment.patients?.name || 'Sin paciente'} · ${Number(appointment.quoted_amount || 0).toLocaleString('es-AR')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Importe
            <input name="amount" type="number" min="0.01" step="0.01" required />
          </label>
          <label>
            Medio
            <select name="method" defaultValue="efectivo">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <input name="idempotency_key" type="hidden" value={`payment-${crypto.randomUUID()}`} />
          <button className="btn" type="submit">Registrar pago</button>
        </form>
      </section>

      <section className="card stack">
        <h2>Movimiento manual de caja</h2>
        <form action={registerCashMovement} className="stack">
          <label>
            Tipo
            <select name="kind" defaultValue="out">
              <option value="in">Ingreso</option>
              <option value="out">Egreso</option>
            </select>
          </label>
          <label>
            Importe
            <input name="amount" type="number" min="0.01" step="0.01" required />
          </label>
          <label>
            Medio / concepto breve
            <input name="method" maxLength={60} required placeholder="efectivo, transferencia, insumo..." />
          </label>
          <button className="btn secondary" type="submit">Registrar movimiento</button>
        </form>
      </section>

      <section className="card stack">
        <h2>Últimos pagos</h2>
        {(payments || []).length === 0 ? <p className="muted">Sin pagos registrados.</p> : (
          <div className="stack">
            {(payments || []).map((payment: any) => (
              <div key={payment.id}>
                <strong>${Number(payment.amount).toLocaleString('es-AR')} {payment.currency}</strong> · {payment.method} · {new Date(payment.created_at).toLocaleString('es-AR')}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Últimos movimientos de caja</h2>
        {(cashMovements || []).length === 0 ? <p className="muted">Sin movimientos.</p> : (
          <div className="stack">
            {(cashMovements || []).map((movement: any) => (
              <div key={movement.id}>
                <strong>{movement.kind === 'in' ? '+' : '-'}${Number(movement.amount).toLocaleString('es-AR')}</strong> · {movement.method} · {new Date(movement.created_at).toLocaleString('es-AR')}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
