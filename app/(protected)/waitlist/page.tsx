import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { addWaitlistEntry, updateWaitlistStatus } from '@/app/(protected)/planning/actions';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PatientCombobox } from '@/components/agenda/PatientCombobox';
import { statusLabel } from '@/lib/labels';

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const [{ data: patients }, { data: services }, { data: waitlist, error: waitlistError }] = await Promise.all([
    supabase.from('patients').select('id, name').eq('tenant_id', tenantId).is('deleted_at', null).order('name'),
    supabase.from('services').select('id, name').eq('tenant_id', tenantId).order('name'),
    supabase.from('waitlist_entries')
      .select('id, patient_id, service_id, preferred_day, preferred_time, notes, status, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);

  if (waitlistError) throw new Error(waitlistError.message);

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p.name]));
  const serviceMap = new Map((services ?? []).map((s) => [s.id, s.name]));
  const ok = typeof params.ok === 'string' ? params.ok : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Lista de espera</h1>
          <p className="muted">Pacientes pendientes de disponibilidad para un turno.</p>
        </div>
        <div className="nav">
          <Link className="btn secondary" href="/planning">Turnos recurrentes</Link>
          <Link className="btn secondary" href="/agenda">← Volver a la agenda</Link>
        </div>
      </div>

      {ok ? <p className="alert success">{ok}</p> : null}
      {error ? <p className="alert error">{error}</p> : null}

      <div className="card">
        <h2>Agregar a lista de espera</h2>
        <form action={addWaitlistEntry} className="stack">
          <input type="hidden" name="return_to" value="/waitlist" />
          <PatientCombobox />
          <label>
            Servicio preferido
            <select name="service_id" defaultValue="">
              <option value="">Cualquier servicio</option>
              {(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Día preferido<input name="preferred_day" maxLength={80} placeholder="Ej. lunes o cualquier día" /></label>
          <label>Horario preferido<input name="preferred_time" maxLength={80} placeholder="Ej. después de las 17" /></label>
          <label style={{ gridColumn: '1 / -1' }}>Notas<textarea name="notes" maxLength={500} rows={3} /></label>
          <div><button className="btn" type="submit">Agregar a espera</button></div>
        </form>
      </div>

      <div className="card">
        <h2>Pacientes en espera</h2>
        {(waitlist ?? []).length === 0 ? (
          <EmptyState title="No hay pacientes en espera" description="Los que agregues van a aparecer acá." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Paciente</th><th>Servicio</th><th>Preferencias</th><th>Notas</th><th>Estado</th><th>Acción</th></tr>
              </thead>
              <tbody>
                {(waitlist ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td>{patientMap.get(entry.patient_id) ?? 'Paciente no disponible'}</td>
                    <td>{entry.service_id ? serviceMap.get(entry.service_id) ?? 'Servicio no disponible' : 'Cualquiera'}</td>
                    <td>{[entry.preferred_day, entry.preferred_time].filter(Boolean).join(' · ') || 'Sin preferencia'}</td>
                    <td>{entry.notes || '—'}</td>
                    <td><StatusBadge status={entry.status} label={statusLabel(entry.status)} /></td>
                    <td>
                      <form action={updateWaitlistStatus} className="nav">
                        <input type="hidden" name="id" value={entry.id} />
                        <input type="hidden" name="return_to" value="/waitlist" />
                        <select name="status" defaultValue={entry.status}>
                          <option value="waiting">En espera</option>
                          <option value="contacted">Contactado</option>
                          <option value="booked">Agendado</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                        <button className="btn secondary" type="submit">Guardar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
