import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { authorizeBillingInvoice } from '../actions';
import { saleConditionLabel } from '@/lib/billing/constants';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value + 'T12:00:00').toLocaleDateString('es-AR');
}

function invoiceNumber(pointOfSale: number | null, voucherNumber: number | null) {
  if (!pointOfSale || !voucherNumber) return '—';
  return `${String(pointOfSale).padStart(5, '0')}-${String(voucherNumber).padStart(8, '0')}`;
}

function statusLabel(status: string) {
  if (status === 'authorized') return 'Emitida';
  if (status === 'authorizing') return 'Procesando';
  if (status === 'rejected') return 'Rechazada';
  return 'Borrador';
}

function statusClass(status: string) {
  if (status === 'authorized') return 'badge-confirmado';
  if (status === 'authorizing') return 'badge-pendiente';
  if (status === 'rejected') return 'badge-cancelado';
  return 'badge-pendiente';
}

export default async function BillingInvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, user, tenantId } = await requireTenant();

  const { data: invoice, error } = await supabase
    .from('billing_invoices')
    .select('*,patients(id,name,dni)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !invoice) notFound();

  const [{ data: lines }, { data: links }] = await Promise.all([
    supabase
      .from('billing_invoice_lines')
      .select('id,description,quantity,unit_price,line_total')
      .eq('tenant_id', tenantId)
      .eq('invoice_id', invoice.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('billing_invoice_appointments')
      .select('appointment_id')
      .eq('tenant_id', tenantId)
      .eq('invoice_id', invoice.id),
  ]);

  const appointmentIds = (links ?? []).map((row: any) => row.appointment_id);
  const { data: appointments } = appointmentIds.length > 0
    ? await supabase
        .from('appointments')
        .select('id,starts_at,quoted_amount,status,services(name)')
        .eq('tenant_id', tenantId)
        .in('id', appointmentIds)
        .order('starts_at', { ascending: true })
    : { data: [] as any[] };

  const canIssue =
    invoice.status === 'draft' &&
    invoice.environment === 'homologacion' &&
    invoice.professional_id === user.id;

  const patient = Array.isArray(invoice.patients) ? invoice.patients[0] : invoice.patients;

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <p><Link href="/billing">← Volver a Facturación</Link></p>
          <h1>Factura {statusLabel(invoice.status).toLowerCase()}</h1>
          <p className="muted">
            {patient?.name ? `Paciente: ${patient.name}` : 'Sin paciente vinculado'}
          </p>
        </div>
        <span className={`badge ${statusClass(invoice.status)}`}>{statusLabel(invoice.status)}</span>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}
      {query.success === 'draft' ? <p className="alert success">Borrador guardado. Revisá los datos antes de emitir.</p> : null}
      {query.success === 'authorized' ? <p className="alert success">ARCA autorizó el comprobante y otorgó CAE.</p> : null}

      <div className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Comprobante</h2>
            <p className="text-helper" style={{ marginTop: 4 }}>
              Factura C · Servicios · {invoice.environment === 'homologacion' ? 'Homologación' : 'Producción'}
            </p>
          </div>
          {invoice.status === 'authorized' ? (
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 12 }}>Número</div>
              <strong>{invoiceNumber(invoice.point_of_sale, invoice.arca_voucher_number)}</strong>
            </div>
          ) : null}
        </div>

        <div className="form-grid">
          <div><span className="muted">Fecha</span><br /><strong>{formatDate(invoice.issue_date)}</strong></div>
          <div><span className="muted">Período</span><br /><strong>{formatDate(invoice.service_from)} al {formatDate(invoice.service_to)}</strong></div>
          <div><span className="muted">Vencimiento</span><br /><strong>{formatDate(invoice.due_date)}</strong></div>
          <div><span className="muted">Punto de venta</span><br /><strong>{invoice.point_of_sale ?? '—'}</strong></div>
          <div><span className="muted">Total</span><br /><strong>$ {Number(invoice.total).toLocaleString('es-AR')} ARS</strong></div>
          <div><span className="muted">Condición de venta</span><br /><strong>{saleConditionLabel(invoice.sale_condition)}</strong></div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Receptor</h2>
        <div className="form-grid">
          <div><span className="muted">Razón social</span><br /><strong>{invoice.recipient_legal_name}</strong></div>
          <div><span className="muted">CUIT / documento</span><br /><strong>{invoice.recipient_cuit ?? invoice.recipient_doc_number ?? '—'}</strong></div>
          <div><span className="muted">Condición frente al IVA</span><br /><strong>{invoice.recipient_vat_condition_label ?? '—'}</strong></div>
          <div><span className="muted">Domicilio</span><br /><strong>{invoice.recipient_address ?? '—'}</strong></div>
          <div><span className="muted">Email</span><br /><strong>{invoice.recipient_email ?? '—'}</strong></div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Prestación</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{invoice.detail}</p>

        {(appointments ?? []).length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <h3>Sesiones incluidas</h3>
            <div className="stack" style={{ gap: 8 }}>
              {(appointments ?? []).map((appointment: any) => (
                <div
                  key={appointment.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '9px 0',
                    borderTop: '1px solid var(--border, #e5e7eb)',
                  }}
                >
                  <span>
                    {new Date(appointment.starts_at).toLocaleDateString('es-AR')} · {appointment.services?.name ?? 'Sesión'}
                  </span>
                  <span className="muted">
                    {appointment.quoted_amount == null ? '—' : `$ ${Number(appointment.quoted_amount).toLocaleString('es-AR')}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(lines ?? []).length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <h3>Detalle interno</h3>
            {(lines ?? []).map((line: any) => (
              <div key={line.id} className="muted">
                {line.quantity} × $ {Number(line.unit_price).toLocaleString('es-AR')} · {line.description}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>ARCA</h2>
        <div className="form-grid">
          <div><span className="muted">Actividad</span><br /><strong>{invoice.activity_code ? `${invoice.activity_code} · ${invoice.activity_description ?? ''}` : 'No informada'}</strong></div>
          <div><span className="muted">Resultado</span><br /><strong>{invoice.arca_result ?? 'Pendiente'}</strong></div>
          <div><span className="muted">CAE</span><br /><strong>{invoice.arca_cae ?? '—'}</strong></div>
          <div><span className="muted">Vencimiento CAE</span><br /><strong>{formatDate(invoice.arca_cae_expires_at)}</strong></div>
        </div>

        {invoice.arca_error_message ? (
          <p className={invoice.status === 'rejected' ? 'alert error' : 'alert'} style={{ marginTop: 14 }}>
            {invoice.arca_error_message}
          </p>
        ) : null}

        {canIssue ? (
          <form action={authorizeBillingInvoice} style={{ marginTop: 18 }}>
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <label className="checkbox-field" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" name="confirm" value="true" required style={{ marginTop: 3 }} />
              <span>
                Confirmo que revisé receptor, período, importe y sesiones. Entiendo que esta acción solicitará un CAE
                <strong> únicamente en ARCA homologación</strong>.
              </span>
            </label>
            <div style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Emitir en ARCA (homologación)</button>
            </div>
          </form>
        ) : invoice.status === 'authorized' ? (
          <p className="alert success" style={{ marginTop: 16 }}>
            Comprobante autorizado. Este registro conserva el snapshot fiscal usado al momento de la emisión.
          </p>
        ) : null}
      </div>
    </section>
  );
}
