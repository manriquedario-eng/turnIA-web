import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createPatient } from './actions';

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
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
      <p className="muted">Datos protegidos por sesión, tenant y RLS de Supabase.</p>

      {params.error ? <p className="alert error">{params.error}</p> : null}
      {params.success === 'created' ? <p className="alert success">Paciente creado correctamente.</p> : null}
      {params.success === 'archived' ? <p className="alert success">Paciente archivado correctamente.</p> : null}

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Nuevo paciente</h2>
        <form action={createPatient} className="form-grid">
          <label>Nombre<input name="name" required minLength={2} maxLength={160} /></label>
          <label>Teléfono<input name="phone" maxLength={160} /></label>
          <label>Email<input name="email" type="email" maxLength={200} /></label>
          <label>DNI<input name="dni" maxLength={160} /></label>
          <label>Obra social<input name="insurance_name" maxLength={160} /></label>
          <label>Nº afiliado<input name="insurance_member_number" maxLength={160} /></label>
          <label>Plan<input name="insurance_plan" maxLength={160} /></label>
          <label>Lugar de atención<input name="care_location" maxLength={160} /></label>
          <label>Precio habitual<input name="default_price" type="number" min="0" step="0.01" /></label>
          <div><button type="submit">Crear paciente</button></div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 20, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Obra social</th><th>Lugar</th><th></th></tr>
          </thead>
          <tbody>
            {(patients ?? []).map((patient) => (
              <tr key={patient.id}>
                <td>{patient.name}</td>
                <td>{patient.phone || '—'}</td>
                <td>{patient.email || '—'}</td>
                <td>{patient.insurance_name || '—'}</td>
                <td>{patient.care_location || '—'}</td>
                <td><Link href={`/patients/${patient.id}`}>Abrir ficha</Link></td>
              </tr>
            ))}
            {!patients?.length ? <tr><td colSpan={6}>No hay pacientes visibles para este tenant.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
