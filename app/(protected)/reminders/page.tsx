import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { IconCheck } from '@/components/ui/icons';
import {
  createReminder,
  deleteReminder,
  postponeReminder,
  setReminderStatus,
  updateReminder,
} from './actions';

const TZ = 'America/Argentina/Buenos_Aires';

type ReminderRow = {
  id: string;
  title: string;
  description: string | null;
  remind_at: string;
  status: 'pending' | 'done';
  created_at: string;
  completed_at: string | null;
};

function todayInTz() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function dateTimeLocal(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, user, tenantId } = await requireTenant();
  const editId = typeof params.edit === 'string' ? params.edit : undefined;
  const ok = typeof params.ok === 'string' ? params.ok : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  // PARTE 9: filtro explícito por tenant_id + professional_id = user.id,
  // además de la RLS de la tabla — un profesional nunca ve recordatorios de
  // otro, ni siquiera dentro del mismo consultorio.
  const { data, error: fetchError } = await supabase
    .from('professional_reminders')
    .select('id, title, description, remind_at, status, created_at, completed_at')
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .order('remind_at', { ascending: true });

  if (fetchError) throw new Error(fetchError.message);
  const reminders = (data ?? []) as ReminderRow[];

  const now = Date.now();
  const today = todayInTz();
  const pending = reminders.filter((r) => r.status === 'pending');
  const done = reminders.filter((r) => r.status === 'done').sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());
  const overdue = pending.filter((r) => new Date(r.remind_at).getTime() < now);
  const dueToday = pending.filter((r) => new Date(r.remind_at).getTime() >= now && dateKeyInTz(r.remind_at) === today);
  const upcoming = pending.filter((r) => new Date(r.remind_at).getTime() >= now && dateKeyInTz(r.remind_at) !== today);

  const editing = editId ? reminders.find((r) => r.id === editId) : undefined;
  const returnTo = '/reminders';

  function ReminderRowView({ reminder, tone }: { reminder: ReminderRow; tone: 'overdue' | 'today' | 'upcoming' | 'done' }) {
    const isEditing = editing?.id === reminder.id;
    if (isEditing) {
      return (
        <li className="reminder-row reminder-row-editing" key={reminder.id}>
          <form action={updateReminder} className="reminder-edit-form">
            <input type="hidden" name="id" value={reminder.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <label>Título<input name="title" defaultValue={reminder.title} required minLength={1} maxLength={160} /></label>
            <label>Descripción<textarea name="description" defaultValue={reminder.description ?? ''} maxLength={2000} rows={2} /></label>
            <label>Fecha y hora<input type="datetime-local" name="remind_at_local" defaultValue={dateTimeLocal(reminder.remind_at)} required /></label>
            <div className="nav" style={{ gap: 8 }}>
              <button className="btn" type="submit">Guardar</button>
              <Link className="btn secondary" href="/reminders">Cancelar</Link>
            </div>
          </form>
        </li>
      );
    }

    return (
      <li className={`reminder-row tone-${tone}`} key={reminder.id}>
        <div className="reminder-row-main">
          <div className="reminder-row-title">{reminder.title}</div>
          {reminder.description ? <div className="muted reminder-row-desc">{reminder.description}</div> : null}
          <div className="muted reminder-row-time">
            {tone === 'overdue' ? 'Vencido · ' : tone === 'today' ? 'Hoy · ' : ''}
            {formatDateTime(reminder.remind_at)}
          </div>
        </div>
        <div className="reminder-row-actions">
          {reminder.status === 'pending' ? (
            <>
              <form action={setReminderStatus}>
                <input type="hidden" name="id" value={reminder.id} />
                <input type="hidden" name="status" value="done" />
                <input type="hidden" name="return_to" value={returnTo} />
                <button className="btn-ghost" type="submit" aria-label="Marcar como realizado" title="Marcar como realizado">
                  <IconCheck size={14} /> Hecho
                </button>
              </form>
              <details className="reminder-postpone">
                <summary className="btn-ghost" role="button">Posponer</summary>
                <form action={postponeReminder} className="reminder-postpone-form">
                  <input type="hidden" name="id" value={reminder.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <input type="datetime-local" name="remind_at_local" defaultValue={dateTimeLocal(reminder.remind_at)} required />
                  <button className="btn secondary" type="submit" style={{ fontSize: 12 }}>Guardar</button>
                </form>
              </details>
              <Link href={`/reminders?edit=${reminder.id}`} className="btn-ghost">Editar</Link>
            </>
          ) : (
            <form action={setReminderStatus}>
              <input type="hidden" name="id" value={reminder.id} />
              <input type="hidden" name="status" value="pending" />
              <input type="hidden" name="return_to" value={returnTo} />
              <button className="btn-ghost" type="submit">Reabrir</button>
            </form>
          )}
          <form action={deleteReminder}>
            <input type="hidden" name="id" value={reminder.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <button className="btn-ghost danger" type="submit">Eliminar</button>
          </form>
        </div>
      </li>
    );
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Recordatorios</h1>
          <p className="muted">Tu agenda personal — no son recordatorios de turnos ni mensajes a pacientes.</p>
        </div>
        <Link className="btn secondary" href="/dashboard">← Volver a Inicio</Link>
      </div>

      {ok ? <p className="alert success">{ok}</p> : null}
      {error ? <p className="alert error">{error}</p> : null}

      <div className="card">
        <h2>Nuevo recordatorio</h2>
        <form action={createReminder} className="form-grid">
          <input type="hidden" name="return_to" value={returnTo} />
          <label>Título<input name="title" required minLength={1} maxLength={160} placeholder="Ej. Llamar al contador" /></label>
          <label>Fecha y hora<input type="datetime-local" name="remind_at_local" required /></label>
          <label style={{ gridColumn: '1 / -1' }}>Descripción (opcional)<textarea name="description" maxLength={2000} rows={2} /></label>
          <div className="form-actions">
            <button className="btn" type="submit">Crear recordatorio</button>
          </div>
        </form>
      </div>

      {/* Segunda pasada de rediseño: antes Vencidos/Hoy/Próximos eran 3
          cards separadas apiladas (mucho "card dentro de card" y huecos
          vacíos cuando un grupo no tiene nada) — ahora es una sola card con
          3 grupos internos, mismo contenido y mismas acciones por fila. */}
      <div className="card">
        <div className="reminder-group">
          <div className="reminder-group-title">
            <span className={overdue.length > 0 ? 'is-overdue' : ''}>Vencidos</span>
            {overdue.length > 0 ? <span className="reminder-group-count is-overdue">{overdue.length}</span> : null}
          </div>
          {overdue.length === 0 ? (
            <p className="text-helper" style={{ margin: 0 }}>Ningún recordatorio vencido.</p>
          ) : (
            <ul className="reminder-list">{overdue.map((r) => <ReminderRowView key={r.id} reminder={r} tone="overdue" />)}</ul>
          )}
        </div>

        <div className="reminder-group">
          <div className="reminder-group-title">
            <span>Hoy</span>
            {dueToday.length > 0 ? <span className="reminder-group-count is-today">{dueToday.length}</span> : null}
          </div>
          {dueToday.length === 0 ? (
            <p className="text-helper" style={{ margin: 0 }}>Nada para hoy.</p>
          ) : (
            <ul className="reminder-list">{dueToday.map((r) => <ReminderRowView key={r.id} reminder={r} tone="today" />)}</ul>
          )}
        </div>

        <div className="reminder-group">
          <div className="reminder-group-title">
            <span>Próximos</span>
            {upcoming.length > 0 ? <span className="reminder-group-count">{upcoming.length}</span> : null}
          </div>
          {upcoming.length === 0 ? (
            <p className="text-helper" style={{ margin: 0 }}>Sin próximos recordatorios.</p>
          ) : (
            <ul className="reminder-list">{upcoming.map((r) => <ReminderRowView key={r.id} reminder={r} tone="upcoming" />)}</ul>
          )}
        </div>
      </div>

      {done.length > 0 ? (
        <div className="card">
          <h2>Realizados</h2>
          <ul className="reminder-list">{done.slice(0, 20).map((r) => <ReminderRowView key={r.id} reminder={r} tone="done" />)}</ul>
        </div>
      ) : null}
    </section>
  );
}
