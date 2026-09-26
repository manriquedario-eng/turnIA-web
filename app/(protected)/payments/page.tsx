import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { registerCashMovement, registerPayment } from './actions';
import { EmptyState } from '@/components/ui/EmptyState';
import { paymentMethodLabel } from '@/lib/labels';
import { SimpleExportMenu } from '@/components/export/ExportMenu';
import { paymentNetAmount } from '@/lib/payments/net';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; export_from?: string; export_to?: string }>;
}) {
  const { supabase, tenantId } = await requireTenant();
  const params = await searchParams;

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const exportFrom = params.export_from && datePattern.test(params.export_from) ? params.export_from : '';
  const exportTo = params.export_to && datePattern.test(params.export_to) ? params.export_to : '';
  const exportRangeParams = new URLSearchParams();
  if (exportFrom) exportRangeParams.set('from', exportFrom);
  if (exportTo) exportRangeParams.set('to', exportTo);
  const exportRangeSuffix = exportRangeParams.toString() ? `&${exportRangeParams.toString()}` : '';

  const [{ data: appointments }, { data: payments }, { data: cashMovements }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, quoted_amount, currency, patients(name)')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false })
      .limit(50),
    supabase
      .from('payments')
      .select('id, amount, currency, method, created_at, patient_id, appointment_id, patients(name), payment_reversals(amount)')
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

  const collected = (payments || []).reduce((sum, item) => sum + paymentNetAmount(item), 0);

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Pagos y caja</h1>
          <p className="muted">Registrá cobros de turnos y movimientos manuales de caja.</p>
        </div>
        <SimpleExportMenu
          links={[
            { format: 'pdf', href: `/api/export/payments?format=pdf${exportRangeSuffix}` },
            { format: 'docx', href: `/api/export/payments?format=docx${exportRangeSuffix}` },
            { format: 'xlsx', href: `/api/export/payments?format=xlsx${exportRangeSuffix}` },
          ]}
        />
      </div>

      {params.ok ? <p className="alert success">{params.ok}</p> : null}
      {params.error ? <p className="alert error">{params.error}</p> : null}

      <section className="card">
        <div className="page-header" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Período de exportación</h2>
            <p className="text-helper" style={{ margin: '6px 0 0' }}>
              Opcional. Si dejás las fechas vacías, TurnIA exporta todo el historial. Los archivos se generan paginados y nunca se recortan silenciosamente.
            </p>
          </div>
        </div>
        <form method="get" className="form-grid">
          <label>
            Desde
            <input type="date" name="export_from" defaultValue={exportFrom} />
          </label>
          <label>
            Hasta
            <input type="date" name="export_to" defaultValue={exportTo} />
          </label>
          <div className="form-actions">
            <button className="btn secondary" type="submit">Aplicar período</button>
            {(exportFrom || exportTo) ? <Link className="btn-ghost" href="/payments">Limpiar período</Link> : null}
          </div>
        </form>
      </section>

      {/* Mismo patrón "hero + franja secundaria" que Dashboard/Métricas —
          Caja actual es el número que más importa acá (cuánto hay en caja
          ahora), Cobrado queda como dato de contexto al lado. Mismos
          cálculos, cero queries nuevas. */}
      <div className="metrics-hero-row">
        <div className="metrics-hero-card">
          <span className="text-label">Caja actual</span>
          <span className="metrics-hero-value">${balance.toLocaleString('es-AR')}</span>
        </div>
        <div className="stat-strip metrics-secondary-strip">
          <div className="stat-strip-item">
            <span className="stat-strip-label">Cobrado</span>
            <span className="stat-strip-value stat-strip-value-money">${collected.toLocaleString('es-AR')}</span>
            <span className="stat-strip-hint">últimos 50 pagos</span>
          </div>
        </div>
      </div>

      <div className="split-main-side">
        <div className="stack">
          <section className="card">
            <h2>Registrar pago</h2>
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
                  <option value="mercado_pago">Mercado Pago</option>
                  <option value="virtual_wallet">Billetera virtual</option>
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
            <h2>Movimiento manual de caja</h2>
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

        <section className="card">
          <h2>Últimos movimientos de caja</h2>
          {(cashMovements || []).length === 0 ? (
            <EmptyState title="Sin movimientos" description="Los movimientos manuales de caja van a aparecer acá." />
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {(cashMovements || []).slice(0, 10).map((movement: any) => (
                <div key={movement.id} className="cash-movement-row">
                  <span className="text-helper">
                    {paymentMethodLabel(movement.method)} · {new Date(movement.created_at).toLocaleString('es-AR')}
                  </span>
                  <strong className={`cash-movement-amount ${movement.kind === 'in' ? 'is-in' : 'is-out'}`}>
                    {movement.kind === 'in' ? '+' : '−'}${Number(movement.amount).toLocaleString('es-AR')}
                  </strong>
                </div>
              ))}
            </div>
          )}
          {(cashMovements || []).length > 10 ? (
            <p className="text-caption" style={{ marginTop: 8, marginBottom: 0 }}>
              Mostrando los últimos 10 movimientos.
            </p>
          ) : null}
        </section>
      </div>

      {/* Últimos pagos, a ancho completo debajo — en la columna angosta de
          1fr de arriba la tabla (Fecha/Paciente/Medio/Importe) no entraba
          bien y el importe quedaba cortado. Acá tiene todo el ancho del
          contenedor. En mobile (≤640px) se reemplaza por una lista
          compacta en vez de forzar la tabla a un scroll horizontal. */}
      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ margin: '18px 20px 12px' }}>Últimos pagos</h2>
        {(payments || []).length === 0 ? (
          <div style={{ padding: '0 20px 20px' }}>
            <EmptyState title="Sin pagos registrados" description="Los pagos que registres van a aparecer acá." />
          </div>
        ) : (
          <>
            <div className="payments-table-wrap" style={{ paddingBottom: 8 }}>
              <table className="table">
                <thead>
                  <tr><th>Fecha</th><th>Paciente</th><th>Medio</th><th className="table-cell-amount">Importe</th></tr>
                </thead>
                <tbody>
                  {(payments || []).map((payment: any) => (
                    <tr key={payment.id}>
                      <td className="muted">{new Date(payment.created_at).toLocaleString('es-AR')}</td>
                      <td>{payment.patients?.name ?? 'Sin paciente'}</td>
                      <td className="muted">{paymentMethodLabel(payment.method)}</td>
                      <td className="table-cell-amount"><strong>${Number(payment.amount).toLocaleString('es-AR')} {payment.currency}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="payments-list-mobile" style={{ padding: '4px 20px 16px' }}>
              {(payments || []).map((payment: any) => (
                <div key={payment.id} className="payment-row-mobile">
                  <div className="payment-row-mobile-top">
                    <strong>{payment.patients?.name ?? 'Sin paciente'}</strong>
                    <strong>${Number(payment.amount).toLocaleString('es-AR')} {payment.currency}</strong>
                  </div>
                  <span className="text-helper">
                    {new Date(payment.created_at).toLocaleDateString('es-AR')} · {paymentMethodLabel(payment.method)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </section>
  );
}
