import { requireTenant } from '@/lib/auth/require-user';

export default async function PatientsPage() {
  const { supabase, tenantId } = await requireTenant();
  const { data: patients, error } = await supabase
    .from('patients')
    .select('id,name,phone,email,insurance_name,care_location,created_at')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`No se pudieron cargar los pacientes: ${error.message}`);
  }

  return (
    <section>
      <h1>Pacientes</h1>
      <p className="muted">Listado protegido por sesión, tenant y RLS de Supabase.</p>
      <div className="card" style={{ marginTop: 20, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Obra social</th><th>Lugar</th></tr>
          </thead>
          <tbody>
            {(patients ?? []).map((patient) => (
              <tr key={patient.id}>
                <td>{patient.name}</td>
                <td>{patient.phone || '—'}</td>
                <td>{patient.email || '—'}</td>
                <td>{patient.insurance_name || '—'}</td>
                <td>{patient.care_location || '—'}</td>
              </tr>
            ))}
            {!patients?.length ? <tr><td colSpan={5}>No hay pacientes visibles para este tenant.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
