import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createReimbursementCase } from '../actions';

export default async function NewReimbursementPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const { data: patients, error } = await supabase
    .from('patients')
    .select('id,name,dni,insurance_name,insurance_member_number,insurance_plan')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name');

  if (error) throw new Error(`No se pudieron cargar los pacientes: ${error.message}`);

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <section className="stack" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div>
          <h1>Nuevo reintegro</h1>
          <p className="muted">TurnIA toma la cobertura del paciente y agrupa sus sesiones del período.</p>
        </div>
        <Link className="btn secondary" href="/reimbursements">Volver</Link>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}

      <form action={createReimbursementCase} className="card stack">
        <label className="field">
          <span>Paciente</span>
          <select name="patient_id" required defaultValue="">
            <option value="" disabled>Seleccionar paciente</option>
            {(patients ?? []).map((patient: any) => (
              <option key={patient.id} value={patient.id}>
                {patient.name}{patient.insurance_name ? ` · ${patient.insurance_name}` : ' · sin cobertura cargada'}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Período</span>
          <input name="period_month" type="month" required defaultValue={currentMonth} />
          <small className="text-helper">Se asociarán automáticamente las sesiones no canceladas de ese mes.</small>
        </label>

        <label className="field">
          <span>Prestación</span>
          <select name="service_type" defaultValue="psychotherapy_individual">
            <option value="psychotherapy_individual">Psicoterapia individual</option>
            <option value="psychological_consultation">Consulta psicológica</option>
            <option value="other">Otra prestación</option>
          </select>
        </label>

        <label className="field">
          <span>Notas internas</span>
          <textarea
            name="notes"
            rows={4}
            maxLength={5000}
            placeholder="Opcional. No se incorpora automáticamente a la documentación del paciente."
          />
        </label>

        <div>
          <button className="btn" type="submit">Crear borrador</button>
        </div>
      </form>

      <p className="text-helper">
        La cobertura, plan y número de afiliado se guardan como una foto del momento. Si después cambian en la ficha del paciente, este reintegro conserva sus datos originales.
      </p>
    </section>
  );
}
