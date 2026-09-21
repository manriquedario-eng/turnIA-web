import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createReimbursementCase } from '../actions';

const TZ = 'America/Argentina/Buenos_Aires';

function todayInArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function endOfDayIso(date: string) {
  return new Date(`${date}T23:59:59.999-03:00`).toISOString();
}

function startOfDayIso(date: string) {
  return new Date(`${date}T00:00:00-03:00`).toISOString();
}

function statusLabel(status: string | null) {
  const normalized = String(status ?? '').toLowerCase();
  if (['scheduled', 'programado'].includes(normalized)) return 'Programado';
  if (['pendiente', 'pending'].includes(normalized)) return 'Pendiente';
  if (['confirmado', 'confirmed'].includes(normalized)) return 'Confirmado';
  if (['completed', 'completado', 'realizado'].includes(normalized)) return 'Realizado';
  if (['cancelled', 'canceled', 'cancelado'].includes(normalized)) return 'Cancelado';
  if (['no_show', 'ausente'].includes(normalized)) return 'Ausente';
  return status || '—';
}

export default async function NewReimbursementPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    patient?: string;
    period_start?: string;
    period_end?: string;
  }>;
}) {
  const query = await searchParams;
  const { supabase, tenantId, user } = await requireTenant();

  const { data: patients, error } = await supabase
    .from('patients')
    .select('id,name,dni,insurance_name,insurance_member_number,insurance_plan')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name');

  if (error) throw new Error(`No se pudieron cargar los pacientes: ${error.message}`);

  const today = todayInArgentina();
  const selectedPatientId = query.patient ?? '';
  const periodStart = query.period_start ?? monthStart(today);
  const periodEnd = query.period_end ?? today;

  const selectedPatient = (patients ?? []).find((patient: any) => patient.id === selectedPatientId);

  let appointments: any[] = [];
  if (selectedPatient && periodStart && periodEnd) {
    const { data, error: appointmentsError } = await supabase
      .from('appointments')
      .select('id,starts_at,status,modality,quoted_amount,currency,services(name)')
      .eq('tenant_id', tenantId)
      .eq('patient_id', selectedPatient.id)
      .eq('professional_id', user.id)
      .gte('starts_at', startOfDayIso(periodStart))
      .lte('starts_at', endOfDayIso(periodEnd))
      .order('starts_at', { ascending: true });

    if (appointmentsError) {
      throw new Error(`No se pudieron cargar las sesiones del período: ${appointmentsError.message}`);
    }

    appointments = (data ?? []).filter((appointment: any) => {
      const normalized = String(appointment.status ?? '').toLowerCase();
      return !['cancelado', 'cancelled', 'canceled'].includes(normalized);
    });
  }

  return (
    <section className="stack" style={{ maxWidth: 860 }}>
      <div className="page-header">
        <div>
          <h1>Nuevo reintegro</h1>
          <p className="muted">Elegí el período real y las sesiones exactas que deben incluirse.</p>
        </div>
        <Link className="btn secondary" href="/reimbursements">Volver</Link>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}

      <div className="card stack">
        <div>
          <h2 style={{ marginBottom: 4 }}>1. Paciente y período</h2>
          <p className="text-helper" style={{ marginTop: 0 }}>
            El período puede ser un solo día, parte del mes o cualquier rango necesario.
          </p>
        </div>

        <form method="get" action="/reimbursements/new" className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>
            Paciente
            <select name="patient" required defaultValue={selectedPatientId}>
              <option value="" disabled>Seleccionar paciente</option>
              {(patients ?? []).map((patient: any) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}{patient.insurance_name ? ` · ${patient.insurance_name}` : ' · sin cobertura cargada'}
                </option>
              ))}
            </select>
          </label>

          <label>
            Desde
            <input name="period_start" type="date" required defaultValue={periodStart} />
          </label>

          <label>
            Hasta
            <input name="period_end" type="date" required defaultValue={periodEnd} />
          </label>

          <div className="form-actions">
            <button className="btn secondary" type="submit">Buscar sesiones</button>
          </div>
        </form>
      </div>

      {selectedPatient ? (
        <form action={createReimbursementCase} className="card stack">
          <input type="hidden" name="patient_id" value={selectedPatient.id} />
          <input type="hidden" name="period_start" value={periodStart} />
          <input type="hidden" name="period_end" value={periodEnd} />

          <div>
            <h2 style={{ marginBottom: 4 }}>2. Sesiones a incluir</h2>
            <p className="muted" style={{ margin: 0 }}>
              {selectedPatient.name} · {selectedPatient.insurance_name || 'Sin cobertura cargada'}
              {selectedPatient.insurance_plan ? ` · Plan ${selectedPatient.insurance_plan}` : ''}
            </p>
          </div>

          {appointments.length === 0 ? (
            <p className="alert">
              No hay sesiones no canceladas dentro del rango elegido. Podés cambiar las fechas y volver a buscar.
            </p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {appointments.map((appointment: any) => (
                <label
                  key={appointment.id}
                  className="card"
                  style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', boxShadow: 'none' }}
                >
                  <input
                    type="checkbox"
                    name="appointment_ids"
                    value={appointment.id}
                    defaultChecked
                    style={{ width: 'auto' }}
                  />
                  <span style={{ flex: 1 }}>
                    <strong>
                      {new Intl.DateTimeFormat('es-AR', {
                        timeZone: TZ,
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(appointment.starts_at))}
                    </strong>
                    <span className="muted" style={{ display: 'block' }}>
                      {appointment.services?.name ?? 'Sesión'} · {statusLabel(appointment.status)}
                      {appointment.quoted_amount != null
                        ? ` · ${appointment.currency ?? 'ARS'} ${Number(appointment.quoted_amount).toLocaleString('es-AR')}`
                        : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

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
            <button className="btn" type="submit" disabled={appointments.length === 0}>
              Crear borrador con sesiones seleccionadas
            </button>
          </div>
        </form>
      ) : null}

      <p className="text-helper">
        La cobertura, plan y número de afiliado se guardan como una foto del momento. Si después cambian en la ficha del paciente, este reintegro conserva sus datos originales.
      </p>
    </section>
  );
}
