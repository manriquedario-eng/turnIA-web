import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { saleConditionLabel } from '@/lib/billing/constants';

function statusLabel(status: string) {
  if (status === 'authorized') return 'Emitida';
  if (status === 'authorizing') return 'Procesando';
  if (status === 'rejected') return 'Rechazada';
  return 'Borrador';
}

function statusBadge(status: string) {
  if (status === 'authorized') return 'badge-confirmado';
  if (status === 'authorizing') return 'badge-pendiente';
  if (status === 'rejected') return 'badge-cancelado';
  return 'badge-pendiente';
}

function voucherNumber(pointOfSale: number | null, number: number | null) {
  if (!pointOfSale || !number) return '—';
  return `${String(pointOfSale).padStart(5, '0')}-${String(number).padStart(8, '0')}`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const query = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const { data: invoices, error } = await supabase
    .from('billing_invoices')
    .select('id,status,recipient_mode,issue_date,total,recipient_legal_name,patient_id,point_of_sale,arca_voucher_number,arca_cae,sale_condition,created_at,patients(name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`No se pudieron cargar las facturas: ${error.message}`);
  }

  const rows = invoices ?? [];
  const draftCount = rows.filter((invoice: any) => invoice.status === 'draft').length;
  const authorizedCount = rows.filter((invoice: any) => invoice.status === 'authorized').length;
  const authorizedTotal = rows
    .filter((invoice: any) => invoice.status === 'authorized')
    .reduce((sum: number, invoice: any) => sum + Number(invoice.total ?? 0), 0);

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Facturación</h1>
          <p className="muted">Borradores y comprobantes emitidos desde TurnIA.</p>
        </div>
        <Link className="btn" href="/billing/new">Nueva factura</Link>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}
      {query.success ? <p className="alert success">{query.success}</p> : null}

      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="stat-strip-label">Borradores</span>
          <span className="stat-strip-value">{draftCount}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Emitidas</span>
          <span className="stat-strip-value">{authorizedCount}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Total emitido</span>
          <span className="stat-strip-value">$ {authorizedTotal.toLocaleString('es-AR')}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 20 }}>
            <p className="muted" style={{ margin: 0 }}>Todavía no hay facturas ni borradores.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 12 }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Estado</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Paciente</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Receptor</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Circuito</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Comprobante</th>
                <th style={{ textAlign: 'right', padding: 12 }}>Total</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Condición venta</th>
                <th style={{ padding: 12 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice: any) => (
                <tr key={invoice.id}>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {new Date(invoice.issue_date + 'T12:00:00').toLocaleDateString('es-AR')}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    <span className={`badge ${statusBadge(invoice.status)}`}>{statusLabel(invoice.status)}</span>
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {invoice.patients?.name ?? '—'}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {invoice.recipient_legal_name}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {invoice.recipient_mode === 'direct_payer' ? 'Obra social / empresa' : 'Paciente / reintegro'}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {voucherNumber(invoice.point_of_sale, invoice.arca_voucher_number)}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)', textAlign: 'right' }}>
                    $ {Number(invoice.total).toLocaleString('es-AR')}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {saleConditionLabel(invoice.sale_condition)}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)', textAlign: 'right' }}>
                    <Link href={`/billing/${invoice.id}`}>Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-helper">
        La emisión fiscal de producción continúa deshabilitada. Los borradores actuales sólo pueden emitirse contra ARCA homologación.
      </p>
    </section>
  );
}
