import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { cancelAppointment, createAppointment, updateAppointment } from './actions';

function startOfDayIso(date: string) {
  return new Date(`${date}T00:00:00-03:00`).toISOString();
}

function endOfDayIso(date: string) {
  return new Date(`${date}T23:59:59-03:00`).toISOString();
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00-03:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function todayInMendoza() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateTimeLocal(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function localInputToIsoValue(local: string) {
  return new Date(`${local}:00-03:00`).toISOString();
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();
  const view = ['day', 'week', 'month'].includes(String(params.view)) ? String(params.view) : 'day';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date)) ? String(params.date) : todayInMendoza();
  const editId = typeof params.edit === 'string' ? params.edit : undefined;

  let rangeStart = date;
  let rangeEnd = date;
  if (view === 'week') rangeEnd = addDays(date, 6);
  if (view === 'month') {
    const first = `${date.slice(0, 7)}-01`;
    const nextMonth = new Date(`${first}T12:00:00-03:00`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
    rangeStart = first;
    rangeEnd = nextMonth.toISOString().slice(0, 10);
  }

  const [{ data: appointments, error: appointmentError }, { data: patients }, { data: services }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, patient_id, service_id, starts_at, ends_at, modality, status, quoted_amount, currency')
      .eq('tenant_id', tenantId)
      .gte('starts_at', startOfDayIso(rangeStart))
      .lte('starts_at', endOfDayIso(rangeEnd))
      .order('starts_at', { ascending: true }),
    supabase
      .from('patients')
      .select('id, name, default_price')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('services')
      .select('id, name, duration_minutes, price, currency')
      .eq('tenant_id', tenantId)
      .order('name'),
  ]);

  if (appointmentError) throw new Error(appointmentError.message);

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p]));
  const serviceMap = new Map((services ?? []).map((s) => [s.id, s]));
  const editing = editId ? (appointments ?? []).find((a) => a.id === editId) : undefined;
  const returnTo = `/agenda?view=${view}&date=${date}`;
  const ok = typeof params.ok === 'string' ? params.ok : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p className="muted">Turnos del consultorio · horario Mendoza</p>
        </div>
      </div>

      {ok ? <p className="alert success">{ok}</p> : null}
      {error ? <p className="alert error">{error}</p> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="nav">
            <Link href={`/agenda?view=day&date=${date}`}>Día</Link>
            <Link href={`/agenda?view=week&date=${date}`}>Semana</Link>
            <Link href={`/agenda?view=month&date=${date}`}>Mes</Link>
          </div>
          <form method="get" className="nav">
            <input type="hidden" name="view" value={view} />
            <input type="date" name="date" defaultValue={date} />
            <button className="btn secondary" type="submit">Ir</button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>{editing ? 'Editar / reprogramar turno' : 'Nuevo turno'}</h2>
        <form action={editing ? updateAppointment : createAppointment} className="form-grid">
          <input type="hidden" name="return_to" value={returnTo} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          <label>Paciente
            <select name="patient_id" required defaultValue={editing?.patient_id ?? ''}>
              <option value="" disabled>Seleccionar paciente</option>
              {(patients ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label>Servicio
            <select name="service_id" required defaultValue={editing?.service_id ?? ''}>
              <option value="" disabled>Seleccionar servicio</option>
              {(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>)}
            </select>
          </label>

          <label>Inicio
            <input name="starts_at_local" type="datetime-local" required defaultValue={editing ? dateTimeLocal(editing.starts_at) : `${date}T09:00`} />
            <input name="starts_at" type="hidden" value={editing ? editing.starts_at : localInputToIsoValue(`${date}T09:00`)} />
          </label>

          <label>Fin
            <input name="ends_at_local" type="datetime-local" required defaultValue={editing ? dateTimeLocal(editing.ends_at) : `${date}T09:30`} />
            <input name="ends_at" type="hidden" value={editing ? editing.ends_at : localInputToIsoValue(`${date}T09:30`)} />
          </label>

          <label>Modalidad
            <select name="modality" defaultValue={editing?.modality ?? 'presencial'}>
              <option value="presencial">Presencial</option>
              <option value="domicilio">Domicilio</option>
              <option value="online">Online</option>
            </select>
          </label>

          <label>Monto
            <input name="quoted_amount" type="number" min="0" step="0.01" defaultValue={editing?.quoted_amount ?? ''} />
          </label>

          <div className="nav">
            <button className="btn" type="submit">{editing ? 'Guardar cambios' : 'Crear turno'}</button>
            {editing ? <Link className="btn secondary" href={returnTo}>Cancelar edición</Link> : null}
          </div>
        </form>
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          La reconstrucción usa la zona horaria del proyecto: America/Argentina/Buenos_Aires.
        </p>
      </div>

      <div className="card">
        <h2>{view === 'day' ? 'Turnos del día' : view === 'week' ? 'Turnos de la semana' : 'Turnos del mes'}</h2>
        {(appointments ?? []).length === 0 ? (
          <p className="muted">No hay turnos en este período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Fecha y hora</th><th>Paciente</th><th>Servicio</th><th>Modalidad</th><th>Estado</th><th>Monto</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {(appointments ?? []).map((a) => {
                  const patient = a.patient_id ? patientMap.get(a.patient_id) : undefined;
                  const service = a.service_id ? serviceMap.get(a.service_id) : undefined;
                  const cancelled = a.status === 'cancelled' || a.status === 'cancelado';
                  return (
                    <tr key={a.id}>
                      <td>{formatDateTime(a.starts_at)} – {new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', timeStyle: 'short' }).format(new Date(a.ends_at))}</td>
                      <td>{patient?.name ?? 'Paciente no disponible'}</td>
                      <td>{service?.name ?? 'Servicio no disponible'}</td>
                      <td>{a.modality}</td>
                      <td>{a.status}</td>
                      <td>{a.quoted_amount != null ? `${a.currency} ${a.quoted_amount}` : '—'}</td>
                      <td>
                        <div className="nav">
                          {!cancelled ? <Link href={`${returnTo}&edit=${a.id}`}>Editar</Link> : null}
                          {!cancelled ? (
                            <form action={cancelAppointment}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="return_to" value={returnTo} />
                              <button className="btn danger" type="submit">Cancelar</button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
