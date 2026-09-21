import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';

function statusLabel(status: string) {
  if (status === 'ready') return 'Listo';
  if (status === 'submitted') return 'Presentado';
  if (status === 'approved') return 'Aprobado';
  if (status === 'observed') return 'Observado';
  if (status === 'rejected') return 'Rechazado';
  if (status === 'closed') return 'Cerrado';
  return 'Borrador';
}

function statusBadge(status: string) {
  if (status === 'approved' || status === 'closed') return 'badge-confirmado';
  if (status === 'observed' || status === 'rejected') return 'badge-cancelado';
  return 'badge-pendiente';
}

function periodLabel(start: string, end: string) {
  const from = new Date(start + 'T12:00:00');
  const to = new Date(end + 'T12:00:00');
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return from.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }
  return `${from.toLocaleDateString('es-AR')} – ${to.toLocaleDateString('es-AR')}`;
}

export default async function ReimbursementsPage() {
  const { supabase, tenantId, user } = await requireTenant();

  const [{ data: cases, error }, { data: links }] = await Promise.all([
    supabase
      .from('reimbursement_cases')
      .select('id,status,coverage_name,coverage_plan,member_number,period_start,period_end,invoice_id,created_at,patients(name)')
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('reimbursement_case_appointments')
      .select('reimbursement_case_id')
      .eq('tenant_id', tenantId),
  ]);

  if (error) throw new Error(`No se pudieron cargar los reintegros: ${error.message}`);

  const counts = new Map<string, number>();
  for (const link of links ?? []) {
    counts.set(link.reimbursement_case_id, (counts.get(link.reimbursement_case_id) ?? 0) + 1);
  }

  const rows = cases ?? [];
  const draftCount = rows.filter((item: any) => item.status === 'draft').length;
  const submittedCount = rows.filter((item: any) => item.status === 'submitted').length;
  const approvedCount = rows.filter((item: any) => ['approved', 'closed'].includes(item.status)).length;

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Reintegros</h1>
          <p className="muted">Armá y controlá la documentación que el paciente presenta a su cobertura.</p>
        </div>
        <Link className="btn" href="/reimbursements/new">Nuevo reintegro</Link>
      </div>

      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="stat-strip-label">Borradores</span>
          <span className="stat-strip-value">{draftCount}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Presentados</span>
          <span className="stat-strip-value">{submittedCount}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Aprobados / cerrados</span>
          <span className="stat-strip-value">{approvedCount}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 20 }}>
            <p className="muted" style={{ margin: 0 }}>
              Todavía no hay reintegros. Creá el primero a partir de un paciente y un período.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 850 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 12 }}>Paciente</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Cobertura</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Período</th>
                <th style={{ textAlign: 'center', padding: 12 }}>Sesiones</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Factura</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Estado</th>
                <th style={{ padding: 12 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((item: any) => (
                <tr key={item.id}>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {item.patients?.name ?? '—'}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    <strong>{item.coverage_name}</strong>
                    {item.coverage_plan ? <div className="muted">{item.coverage_plan}</div> : null}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {periodLabel(item.period_start, item.period_end)}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
                    {counts.get(item.id) ?? 0}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    {item.invoice_id ? 'Vinculada' : 'Pendiente'}
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    <span className={`badge ${statusBadge(item.status)}`}>{statusLabel(item.status)}</span>
                  </td>
                  <td style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)', textAlign: 'right' }}>
                    <Link href={`/reimbursements/${item.id}`}>Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-helper">
        Las reglas de cada obra social o prepaga se incorporarán como requisitos versionados. TurnIA no bloqueará un reintegro por una regla no verificada.
      </p>
    </section>
  );
}
