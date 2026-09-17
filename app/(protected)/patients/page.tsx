import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createPatient } from './actions';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { PatientRow } from '@/components/patients/PatientRow';
import { IconPlus } from '@/components/ui/icons';
import { SimpleExportMenu } from '@/components/export/ExportMenu';

const TZ = 'America/Argentina/Buenos_Aires';

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short' }).format(new Date(iso));
}

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

  const patientIds = (patients ?? []).map((p) => p.id);
  const appointmentsResult = patientIds.length
    ? await supabase
        .from('appointments')
        .select('id, patient_id, starts_at, status')
        .eq('tenant_id', tenantId)
        .in('patient_id', patientIds)
        .order('starts_at', { ascending: true })
    : { data: [] as { id: string; patient_id: string; starts_at: string; status: string | null }[] };

  const now = Date.now();
  const nextByPatient = new Map<string, { starts_at: string; status: string | null }>();
  const lastByPatient = new Map<string, { starts_at: string; status: string | null }>();
  for (const appt of appointmentsResult.data ?? []) {
    if (isCancelled(appt.status)) continue;
    if (!appt.patient_id) continue;
    if (new Date(appt.starts_at).getTime() >= now) {
      if (!nextByPatient.has(appt.patient_id)) nextByPatient.set(appt.patient_id, appt);
    } else {
      lastByPatient.set(appt.patient_id, appt);
    }
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Pacientes</h1>
          <p className="muted">{patients?.length ?? 0} pacientes activos en el consultorio.</p>
        </div>
        <div className="nav" style={{ flexWrap: 'wrap' }}>
          <SimpleExportMenu
            links={[
              { format: 'pdf', href: '/api/export/patients?format=pdf' },
              { format: 'docx', href: '/api/export/patients?format=docx' },
              { format: 'xlsx', href: '/api/export/patients?format=xlsx' },
            ]}
          />
          <Link className="btn" href="#nuevo-paciente"><IconPlus /> Nuevo paciente</Link>
        </div>
      </div>

      {params.error ? <p className="alert error">{params.error}</p> : null}
      {params.success === 'created' ? <p className="alert success">Paciente creado correctamente.</p> : null}
      {params.success === 'archived' ? <p className="alert success">Paciente archivado correctamente.</p> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {(patients ?? []).length === 0 ? (
          <div style={{ padding: 20 }}>
            <EmptyState title="Todavía no cargaste pacientes" description="Creá el primero con el formulario de abajo." />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-patients">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Contacto</th>
                  <th>Próximo turno</th>
                  <th>Estado</th>
                  <th aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {(patients ?? []).map((patient) => {
                  const next = nextByPatient.get(patient.id);
                  const last = lastByPatient.get(patient.id);
                  return (
                    <PatientRow
                      key={patient.id}
                      patient={{
                        id: patient.id,
                        name: patient.name,
                        phone: patient.phone,
                        email: patient.email,
                        nextLabel: next ? formatDate(next.starts_at) : null,
                        nextStatus: next ? next.status : null,
                        lastLabel: last ? formatDate(last.starts_at) : null,
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" id="nuevo-paciente">
        <h2 style={{ marginTop: 0 }}>Nuevo paciente</h2>
        <form action={createPatient} className="form-grid">
          <label>Nombre<input name="name" required minLength={2} maxLength={160} /></label>
          <PhoneInput />
          <label>Email<input name="email" type="email" maxLength={200} /></label>
          <label>DNI<input name="dni" maxLength={160} /></label>
          <label>Obra social<input name="insurance_name" maxLength={160} /></label>
          <label>Nº afiliado<input name="insurance_member_number" maxLength={160} /></label>
          <label>Plan<input name="insurance_plan" maxLength={160} /></label>
          <label>Lugar de atención<input name="care_location" maxLength={160} /></label>
          <label>Precio habitual<input name="default_price" type="number" min="0" step="0.01" /></label>

          <div style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ margin: '4px 0' }}>Comunicación y recordatorios</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Sin autorización explícita, no se enviará ningún mensaje automático en el futuro.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
              <input type="checkbox" name="whatsapp_consent" style={{ width: 'auto' }} />
              Autoriza recibir mensajes por WhatsApp
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
              <input type="checkbox" name="appointment_reminders_opt_in" style={{ width: 'auto' }} />
              Recibir recordatorios automáticos de turnos
            </label>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit">Crear paciente</button>
          </div>
        </form>
      </div>
    </section>
  );
}
