import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { EmptyState } from '@/components/ui/EmptyState';
import { createPrescriptionDraft } from '@/app/(protected)/patients/prescription-actions';

const TZ = 'America/Argentina/Buenos_Aires';

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function statusLabel(status: string) {
  if (status === 'issued') return 'Emitida';
  if (status === 'cancelled') return 'Anulada';
  if (status === 'draft') return 'Borrador';
  if (status === 'sending') return 'Enviando';
  if (status === 'rejected') return 'Rechazada';
  if (status === 'error') return 'Con error';
  return status;
}

function statusClass(status: string) {
  if (status === 'issued') return 'badge-confirmado';
  if (status === 'cancelled' || status === 'rejected' || status === 'error') return 'badge-cancelado';
  if (status === 'sending') return 'badge-pendiente';
  return 'badge-neutral';
}

export default async function PrescriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, tenantId, user } = await requireTenant();

  const [{ data: patients }, { data: prescriptions }, { data: misRxStatus }] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,dni,birth_date,sex,insurance_member_number')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('prescriptions')
      .select('id,patient_id,status,provider_prescription_number,diagnosis,cie10,issued_at,created_at')
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('integration_status')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'misrx')
      .maybeSingle(),
  ]);

  const patientRows = patients ?? [];
  const prescriptionRows = prescriptions ?? [];
  const patientById = new Map(patientRows.map((patient: any) => [patient.id, patient]));
  const selectedPatient = query.patient ? patientById.get(query.patient) : null;
  const connected = misRxStatus?.status === 'connected';
  const drafts = prescriptionRows.filter((item: any) => item.status === 'draft').length;
  const issued = prescriptionRows.filter((item: any) => item.status === 'issued').length;

  return (
    <section className="stack prescriptions-workspace">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Consultorio</p>
          <h1>Recetas electrónicas</h1>
          <p className="muted">
            Prepará, revisá y consultá las recetas de tus pacientes desde un único lugar.
          </p>
        </div>
        <span className={`badge ${connected ? 'badge-confirmado' : 'badge-neutral'}`}>
          {connected ? 'MisRX conectado' : 'MisRX no conectado'}
        </span>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}

      <div className="prescriptions-overview">
        <div className="prescriptions-stat">
          <span className="prescriptions-stat-label">Borradores</span>
          <strong>{drafts}</strong>
        </div>
        <div className="prescriptions-stat">
          <span className="prescriptions-stat-label">Emitidas</span>
          <strong>{issued}</strong>
        </div>
        <div className="prescriptions-stat">
          <span className="prescriptions-stat-label">Total</span>
          <strong>{prescriptionRows.length}</strong>
        </div>
      </div>

      <div className="card prescriptions-create-card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Nueva receta</h2>
            <p className="text-helper" style={{ margin: '6px 0 0' }}>
              Elegí el paciente y creá un borrador. Nada se envía a MisRX hasta la etapa de emisión.
            </p>
          </div>
          {selectedPatient ? (
            <Link className="btn-ghost" href={`/patients/${selectedPatient.id}`}>
              Ver paciente
            </Link>
          ) : null}
        </div>

        <details open={Boolean(selectedPatient)}>
          <summary className="btn secondary prescriptions-summary">
            {selectedPatient ? `Nueva receta para ${selectedPatient.name}` : 'Crear nueva receta'}
          </summary>
          <form action={createPrescriptionDraft} className="form-grid prescriptions-create-form">
            <label style={{ gridColumn: '1 / -1' }}>
              Paciente
              <select name="patientId" defaultValue={selectedPatient?.id ?? ''} required>
                <option value="" disabled>Seleccionar paciente</option>
                {patientRows.map((patient: any) => (
                  <option key={patient.id} value={patient.id}>{patient.name}</option>
                ))}
              </select>
            </label>
            <label>
              Diagnóstico
              <input name="diagnosis" maxLength={500} placeholder="Opcional" />
            </label>
            <label>
              CIE-10
              <input name="cie10" maxLength={20} placeholder="Se puede completar después" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Observaciones / indicaciones
              <textarea name="observations" maxLength={4000} rows={3} placeholder="Opcional" />
            </label>
            <label className="checkbox-field" style={{ gridColumn: '1 / -1' }}>
              <input type="checkbox" name="longTermTreatment" />
              Tratamiento prolongado
            </label>
            <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn" type="submit">Crear borrador y continuar</button>
            </div>
          </form>
        </details>
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Historial de recetas</h2>
            <p className="text-helper" style={{ margin: '6px 0 0' }}>
              Incluye borradores y recetas procesadas por el profesional actual.
            </p>
          </div>
        </div>

        {prescriptionRows.length === 0 ? (
          <EmptyState
            title="Todavía no hay recetas"
            description="Creá el primer borrador desde el formulario de arriba."
          />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {prescriptionRows.map((rx: any) => {
              const patient = patientById.get(rx.patient_id);
              return (
                <div key={rx.id} className="prescription-row">
                  <div className="prescription-row-main">
                    <div className="prescription-row-title">
                      <span>{patient?.name ?? 'Paciente'}</span>
                      <span className={`badge ${statusClass(rx.status)}`}>{statusLabel(rx.status)}</span>
                    </div>
                    <div className="prescription-row-desc">
                      {rx.provider_prescription_number ? `Receta ${rx.provider_prescription_number} · ` : ''}
                      {formatDateTime(rx.issued_at ?? rx.created_at)}
                      {rx.cie10 ? ` · CIE-10 ${rx.cie10}` : ''}
                      {rx.diagnosis ? ` · ${rx.diagnosis}` : ''}
                    </div>
                  </div>
                  <div className="prescription-row-actions">
                    <Link
                      className="btn secondary btn-compact"
                      href={`/patients/${rx.patient_id}/prescriptions/${rx.id}`}
                    >
                      {rx.status === 'draft' ? 'Completar borrador' : 'Ver receta'}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
