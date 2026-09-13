import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createPatient } from './actions';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconMail, IconPhone, IconPlus, IconSearch } from '@/components/ui/icons';

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
          <Link className="btn secondary" href="/search"><IconSearch size={16} /> Buscar paciente</Link>
          <Link className="btn" href="#nuevo-paciente"><IconPlus /> Nuevo paciente</Link>
        </div>
      </div>

      {params.error ? <p className="alert error">{params.error}</p> : null}
      {params.success === 'created' ? <p className="alert success">Paciente creado correctamente.</p> : null}
      {params.success === 'archived' ? <p className="alert success">Paciente archivado correctamente.</p> : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Listado</h2>
        {(patients ?? []).length === 0 ? (
          <EmptyState title="Todavía no cargaste pacientes" description="Creá el primero con el formulario de abajo." />
        ) : (
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            {(patients ?? []).map((patient) => {
              const next = nextByPatient.get(patient.id);
              const last = lastByPatient.get(patient.id);
              const initials = patient.name.trim().slice(0, 2).toUpperCase();
              return (
                <div key={patient.id} className="patient-row">
                  <div className="patient-row-main">
                    <div className="patient-avatar">{initials}</div>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/patients/${patient.id}`} style={{ fontWeight: 700 }}>{patient.name}</Link>
                      <div className="muted" style={{ fontSize: 13, display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                        {patient.phone ? <span><IconPhone size={13} /> {patient.phone}</span> : null}
                        {patient.email ? <span><IconMail size={13} /> {patient.email}</span> : null}
                        {!patient.phone && !patient.email ? <span>Sin datos de contacto</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="patient-row-meta">
                    <div style={{ textAlign: 'right', fontSize: 12 }}>
                      {next ? (
                        <div>
                          <span className="muted">Próximo turno</span>{' '}
                          <strong>{formatDate(next.starts_at)}</strong> <StatusBadge status={next.status} />
                        </div>
                      ) : last ? (
                        <div className="muted">Último turno: {formatDate(last.starts_at)}</div>
                      ) : (
                        <div className="muted">Sin turnos</div>
                      )}
                    </div>
                    <div className="nav" style={{ gap: 8 }}>
                      <Link className="btn secondary" href={`/patients/${patient.id}`} style={{ padding: '7px 12px', fontSize: 13 }}>
                        Abrir ficha
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" id="nuevo-paciente">
        <h2 style={{ marginTop: 0 }}>Nuevo paciente</h2>
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
          <div className="form-actions">
            <button className="btn" type="submit">Crear paciente</button>
          </div>
        </form>
      </div>
    </section>
  );
}
