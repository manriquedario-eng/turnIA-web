import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';

function serviceLabel(value: string) {
  if (value === 'psychotherapy_individual') return 'Psicoterapia individual';
  if (value === 'psychological_consultation') return 'Consulta psicológica';
  if (value === 'other') return 'Otra prestación';
  return value;
}

function reimbursementStatusLabel(status: string) {
  if (status === 'ready') return 'Listo';
  if (status === 'submitted') return 'Presentado';
  if (status === 'approved') return 'Aprobado';
  if (status === 'observed') return 'Observado';
  if (status === 'rejected') return 'Rechazado';
  if (status === 'closed') return 'Cerrado';
  return 'Borrador';
}

function appointmentStatusLabel(status: string | null) {
  const normalized = String(status ?? '').toLowerCase();
  if (['scheduled', 'programado'].includes(normalized)) return 'Programado';
  if (['pendiente', 'pending'].includes(normalized)) return 'Pendiente';
  if (['confirmado', 'confirmed'].includes(normalized)) return 'Confirmado';
  if (['completed', 'completado', 'realizado'].includes(normalized)) return 'Realizado';
  if (['cancelled', 'canceled', 'cancelado'].includes(normalized)) return 'Cancelado';
  if (['no_show', 'ausente'].includes(normalized)) return 'Ausente';
  return status || '—';
}

function modalityLabel(modality: string | null) {
  if (modality === 'presencial') return 'Presencial';
  if (modality === 'online') return 'Virtual';
  if (modality === 'domicilio') return 'Domicilio';
  return modality || '—';
}

function sessionCountLabel(count: number) {
  if (count === 1) return '1 sesión asociada';
  return `${count} sesiones asociadas`;
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 2,
  }).format(amount);
}

export default async function ReimbursementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, tenantId, user } = await requireTenant();

  const { data: reimbursement, error } = await supabase
    .from('reimbursement_cases')
    .select('id,status,coverage_name,coverage_plan,member_number,service_type,period_start,period_end,invoice_id,notes,patients(id,name,dni,insurance_name,insurance_member_number,insurance_plan),billing_invoices(id,status,issue_date,total,point_of_sale,arca_voucher_number,arca_cae)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .maybeSingle();

  if (error) throw new Error(`No se pudo cargar el reintegro: ${error.message}`);
  if (!reimbursement) notFound();

  const { data: links, error: linksError } = await supabase
    .from('reimbursement_case_appointments')
    .select('id,appointments(id,starts_at,status,modality,quoted_amount,currency,services(name))')
    .eq('tenant_id', tenantId)
    .eq('reimbursement_case_id', id);

  if (linksError) throw new Error(`No se pudieron cargar las sesiones: ${linksError.message}`);

  const sessions = (links ?? [])
    .map((link: any) => link.appointments)
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const patient: any = reimbursement.patients;
  const invoice: any = reimbursement.billing_invoices;

  const checklist = [
    {
      label: 'Cobertura',
      ok: Boolean(reimbursement.coverage_name),
      detail: reimbursement.coverage_name,
    },
    {
      label: 'Número de afiliado',
      ok: Boolean(reimbursement.member_number),
      detail: reimbursement.member_number || 'Falta completar en la ficha del paciente',
    },
    {
      label: 'Sesiones del período',
      ok: sessions.length > 0,
      detail: sessions.length > 0 ? sessionCountLabel(sessions.length) : 'No hay sesiones asociadas',
    },
  ];

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Reintegro · {patient?.name ?? 'Paciente'}</h1>
          <p className="muted">
            {reimbursement.coverage_name}
            {reimbursement.coverage_plan ? ` · Plan ${reimbursement.coverage_plan}` : ''}
            {' · '}
            {new Date(reimbursement.period_start + 'T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link className="btn secondary" href="/reimbursements">Volver</Link>
      </div>

      {query.created ? <p className="alert success">Borrador creado. Revisá los datos y la documentación pendiente.</p> : null}

      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="stat-strip-label">Estado</span>
          <span className="stat-strip-value">{reimbursementStatusLabel(reimbursement.status)}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Sesiones</span>
          <span className="stat-strip-value">{sessions.length}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Prestación</span>
          <span className="stat-strip-value" style={{ fontSize: 16 }}>{serviceLabel(reimbursement.service_type)}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card stack">
          <div>
            <h2 style={{ marginBottom: 4 }}>Datos del reintegro</h2>
            <p className="muted" style={{ margin: 0 }}>Datos utilizados para este reintegro.</p>
          </div>
          <div>
            <strong>Paciente</strong>
            <div>{patient?.name ?? '—'}</div>
            <div className="muted">DNI: {patient?.dni || 'No cargado'}</div>
          </div>
          <div>
            <strong>Cobertura</strong>
            <div>{reimbursement.coverage_name}</div>
            <div className="muted">Plan: {reimbursement.coverage_plan || 'No cargado'}</div>
            <div className="muted">Afiliado: {reimbursement.member_number || 'No cargado'}</div>
          </div>
          <div>
            <strong>Período</strong>
            <div>
              {new Date(reimbursement.period_start + 'T12:00:00').toLocaleDateString('es-AR')} al{' '}
              {new Date(reimbursement.period_end + 'T12:00:00').toLocaleDateString('es-AR')}
            </div>
          </div>
          {reimbursement.notes ? (
            <div>
              <strong>Notas internas</strong>
              <div>{reimbursement.notes}</div>
            </div>
          ) : null}
          {patient?.id ? <Link href={`/patients/${patient.id}`}>Abrir ficha del paciente</Link> : null}
        </div>

        <div className="card stack">
          <div>
            <h2 style={{ marginBottom: 4 }}>Control documental</h2>
            <p className="muted" style={{ margin: 0 }}>
              TurnIA irá adaptando esta lista a los requisitos verificados de cada cobertura.
            </p>
          </div>

          {checklist.map((item) => (
            <div key={item.label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className={`badge ${item.ok ? 'badge-confirmado' : 'badge-pendiente'}`}>
                {item.ok ? 'OK' : 'Pendiente'}
              </span>
              <div>
                <strong>{item.label}</strong>
                <div className="muted">{item.detail}</div>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className={`badge ${invoice?.id ? 'badge-confirmado' : 'badge-pendiente'}`}>
              {invoice?.id ? 'OK' : 'Pendiente'}
            </span>
            <div>
              <strong>Factura ARCA</strong>
              <div className="muted">{invoice?.id ? 'Factura vinculada' : 'Todavía no hay una factura vinculada'}</div>
              {!invoice?.id && patient?.id ? (
                <div style={{ marginTop: 6 }}>
                  <Link href={`/billing/new?patient=${patient.id}&return_to=${encodeURIComponent(`/reimbursements/${reimbursement.id}`)}`}>Crear factura</Link>
                </div>
              ) : invoice?.id ? (
                <div style={{ marginTop: 6 }}>
                  <Link href={`/billing/${invoice.id}`}>Ver factura</Link>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="badge badge-neutral">No disponible</span>
            <div>
              <strong>Firma digital</strong>
              <div className="muted">Se habilitará cuando esté disponible la integración de firma digital legal.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border, #e5e7eb)' }}>
          <h2 style={{ margin: 0 }}>Sesiones incluidas</h2>
        </div>
        {sessions.length === 0 ? (
          <div style={{ padding: 20 }}>
            <p className="muted" style={{ margin: 0 }}>No se encontraron sesiones para este período.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 12 }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Prestación</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Modalidad</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Estado</th>
                <th style={{ textAlign: 'right', padding: 12 }}>Honorario</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session: any) => (
                <tr key={session.id}>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {new Date(session.starts_at).toLocaleDateString('es-AR')}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {session.services?.name || serviceLabel(reimbursement.service_type)}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {modalityLabel(session.modality)}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {appointmentStatusLabel(session.status)}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)', textAlign: 'right' }}>
                    {formatMoney(session.quoted_amount == null ? null : Number(session.quoted_amount), session.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-helper">
        Próxima capa: requisitos versionados por cobertura y plan, generación del paquete documental y firma digital legal.
      </p>
    </section>
  );
}
