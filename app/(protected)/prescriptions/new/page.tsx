import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createBlankPrescriptionDraft } from '@/app/(protected)/patients/prescription-actions';

export default async function NewPrescriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const { data: patients } = await supabase
    .from('patients')
    .select('id,name,dni,insurance_name,insurance_plan,insurance_member_number')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  const patientRows = patients ?? [];

  return (
    <section className="stack prescription-editor">
      <div className="prescription-editor-breadcrumbs">
        <Link href="/prescriptions">← Recetas</Link>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}

      <div className="card prescription-editor-hero">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">Receta electrónica · MisRX</p>
            <h1 style={{ margin: 0 }}>Nueva receta</h1>
            <p className="text-helper" style={{ margin: '6px 0 0' }}>
              Elegí el paciente para abrir directamente el editor completo.
            </p>
          </div>
        </div>
      </div>

      <div className="card misrx-step-card">
        <div className="misrx-step-heading">
          <span className="misrx-step-number">1</span>
          <div>
            <h2>Paciente</h2>
            <p className="text-helper">
              TurnIA traerá automáticamente los datos ya cargados de cobertura, credencial y plan.
            </p>
          </div>
        </div>

        {patientRows.length === 0 ? (
          <p className="alert">Primero necesitás crear un paciente.</p>
        ) : (
          <form action={createBlankPrescriptionDraft} className="form-grid">
            <label style={{ gridColumn: '1 / -1' }}>
              Paciente
              <select name="patientId" defaultValue="" required>
                <option value="" disabled>Seleccionar paciente</option>
                {patientRows.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name}
                    {patient.insurance_name ? ` · ${patient.insurance_name}` : ''}
                    {patient.insurance_plan ? ` · ${patient.insurance_plan}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn" type="submit">Continuar con la receta</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
