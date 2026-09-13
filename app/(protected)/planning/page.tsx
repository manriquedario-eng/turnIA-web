import { requireTenant } from '@/lib/auth/require-user';
import { addWaitlistEntry, createRecurringAppointments, updateWaitlistStatus } from './actions';

function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();
  const [{ data: patients }, { data: services }, { data: waitlist, error: waitlistError }] = await Promise.all([
    supabase.from('patients').select('id, name').eq('tenant_id', tenantId).is('deleted_at', null).order('name'),
    supabase.from('services').select('id, name, duration_minutes, price, currency').eq('tenant_id', tenantId).order('name'),
    supabase.from('waitlist_entries').select('id, patient_id, service_id, preferred_day, preferred_time, notes, status, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
  ]);
  if (waitlistError) throw new Error(waitlistError.message);

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p.name]));
  const serviceMap = new Map((services ?? []).map((s) => [s.id, s.name]));
  const ok = typeof params.ok === 'string' ? params.ok : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;
  const date = todayLocal();

  return (
    <section className="stack">
      <div>
        <h1>Recurrentes y lista de espera</h1>
        <p className="muted">Organización de turnos repetidos y pacientes pendientes de disponibilidad.</p>
      </div>

      {ok ? <p className="alert success">{ok}</p> : null}
      {error ? <p className="alert error">{error}</p> : null}

      <div className="card">
        <h2>Crear turnos recurrentes</h2>
        <form action={createRecurringAppointments} className="form-grid">
          <label>Paciente
            <select name="patient_id" required defaultValue=""><option value="" disabled>Seleccionar paciente</option>{(patients ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label>Servicio
            <select name="service_id" required defaultValue=""><option value="" disabled>Seleccionar servicio</option>{(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>)}</select>
          </label>
          <label>Primer inicio<input name="starts_at_local" type="datetime-local" required defaultValue={`${date}T09:00`} /></label>
          <label>Primer fin<input name="ends_at_local" type="datetime-local" required defaultValue={`${date}T09:30`} /></label>
          <label>Frecuencia
            <select name="frequency" defaultValue="weekly"><option value="weekly">Semanal</option><option value="biweekly">Cada 2 semanas</option><option value="monthly">Mensual</option></select>
          </label>
          <label>Cantidad<input name="occurrences" type="number" min="2" max="24" defaultValue="4" required /></label>
          <label>Modalidad
            <select name="modality" defaultValue="presencial"><option value="presencial">Presencial</option><option value="domicilio">Domicilio</option><option value="online">Online</option></select>
          </label>
          <label>Monto<input name="quoted_amount" type="number" min="0" step="0.01" placeholder="Usa el precio del servicio si se deja vacío" /></label>
          <div><button className="btn" type="submit">Crear serie</button></div>
        </form>
        <p className="muted" style={{ fontSize: 12 }}>Se crean entre 2 y 24 turnos en una única operación. No se modifica el esquema de turnos existente.</p>
      </div>

      <div className="card">
        <h2>Agregar a lista de espera</h2>
        <form action={addWaitlistEntry} className="form-grid">
          <label>Paciente
            <select name="patient_id" required defaultValue=""><option value="" disabled>Seleccionar paciente</option>{(patients ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label>Servicio preferido
            <select name="service_id" defaultValue=""><option value="">Cualquier servicio</option>{(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label>Día preferido<input name="preferred_day" maxLength={80} placeholder="Ej. lunes o cualquier día" /></label>
          <label>Horario preferido<input name="preferred_time" maxLength={80} placeholder="Ej. después de las 17" /></label>
          <label style={{ gridColumn: '1 / -1' }}>Notas<textarea name="notes" maxLength={500} rows={3} /></label>
          <div><button className="btn" type="submit">Agregar a espera</button></div>
        </form>
      </div>

      <div className="card">
        <h2>Lista de espera</h2>
        {(waitlist ?? []).length === 0 ? <p className="muted">No hay pacientes en espera.</p> : (
          <div style={{ overflowX: 'auto' }}><table className="table"><thead><tr><th>Paciente</th><th>Servicio</th><th>Preferencias</th><th>Notas</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
            {(waitlist ?? []).map((entry) => <tr key={entry.id}>
              <td>{patientMap.get(entry.patient_id) ?? 'Paciente no disponible'}</td>
              <td>{entry.service_id ? serviceMap.get(entry.service_id) ?? 'Servicio no disponible' : 'Cualquiera'}</td>
              <td>{[entry.preferred_day, entry.preferred_time].filter(Boolean).join(' · ') || 'Sin preferencia'}</td>
              <td>{entry.notes || '—'}</td>
              <td>{entry.status}</td>
              <td><form action={updateWaitlistStatus} className="nav"><input type="hidden" name="id" value={entry.id} /><select name="status" defaultValue={entry.status}><option value="waiting">En espera</option><option value="contacted">Contactado</option><option value="booked">Turno asignado</option><option value="cancelled">Cancelado</option></select><button className="btn secondary" type="submit">Guardar</button></form></td>
            </tr>)}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}
