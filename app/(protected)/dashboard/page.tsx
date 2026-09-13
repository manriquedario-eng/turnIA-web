import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';

export default async function DashboardPage() {
  const { supabase, tenantId } = await requireTenant();

  const [patientsResult, appointmentsResult, paymentsResult] = await Promise.all([
    supabase.from('patients').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('deleted_at', null),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('payments').select('amount').eq('tenant_id', tenantId),
  ]);

  const collected = (paymentsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return (
    <section>
      <h1>Inicio</h1>
      <p className="muted">Base de recuperación conectada al staging existente de TurnIA.</p>
      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card"><div className="muted">Pacientes</div><strong style={{ fontSize: 28 }}>{patientsResult.count ?? 0}</strong></div>
        <div className="card"><div className="muted">Turnos</div><strong style={{ fontSize: 28 }}>{appointmentsResult.count ?? 0}</strong></div>
        <div className="card"><div className="muted">Cobrado registrado</div><strong style={{ fontSize: 28 }}>${collected.toLocaleString('es-AR')}</strong></div>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Reconstrucción</h2>
        <p>La primera vertical activa es autenticación segura, tenant y pacientes.</p>
        <Link className="btn" href="/patients">Abrir pacientes</Link>
      </div>
    </section>
  );
}
