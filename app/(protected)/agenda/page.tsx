import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { cancelAppointment, createAppointment, updateAppointment } from './actions';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconChevronLeft, IconChevronRight, IconPlus } from '@/components/ui/icons';

const TZ = 'America/Argentina/Buenos_Aires';

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

function shiftMonth(date: string, delta: number) {
  const first = `${date.slice(0, 7)}-01`;
  const value = new Date(`${first}T12:00:00-03:00`);
  value.setUTCMonth(value.getUTCMonth() + delta);
  return value.toISOString().slice(0, 10);
}

function todayInMendoza() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateTimeLocal(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function formatShortDay(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso)).replace(/\.$/, '').replace(',', '');
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function periodLabel(view: string, date: string) {
  const anchor = new Date(`${date}T12:00:00-03:00`);
  if (view === 'day') {
    return capitalize(new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(anchor));
  }
  if (view === 'week') {
    const end = new Date(`${addDays(date, 6)}T12:00:00-03:00`);
    const fmt = (d: Date) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
    return `Semana del ${fmt(anchor)} al ${fmt(end)}`;
  }
  return capitalize(new Intl.DateTimeFormat('es-AR', { timeZone: TZ, month: 'long', year: 'numeric' }).format(anchor));
}

function localInputToIsoValue(local: string) {
  return new Date(`${local}:00-03:00`).toISOString();
}

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, user, tenantId } = await requireTenant();
  const view = ['day', 'week', 'month'].includes(String(params.view)) ? String(params.view) : 'day';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date)) ? String(params.date) : todayInMendoza();
  const editId = typeof params.edit === 'string' ? params.edit : undefined;
  const todayDate = todayInMendoza();

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

  const prevDate = view === 'day' ? addDays(date, -1) : view === 'week' ? addDays(date, -7) : shiftMonth(date, -1);
  const nextDate = view === 'day' ? addDays(date, 1) : view === 'week' ? addDays(date, 7) : shiftMonth(date, 1);

  const [{ data: appointments, error: appointmentError }, { data: patients }, { data: services }, { data: googleIntegration }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, patient_id, service_id, starts_at, ends_at, modality, status, quoted_amount, currency, meeting_provider, meeting_url')
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
    // Estado de Google Calendar del PROFESIONAL logueado (no del tenant
    // entero — cada profesional conecta su propia cuenta). Sin fila todavía
    // => nunca conectó, se trata igual que "not_connected".
    supabase
      .from('integration_status')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'google_calendar')
      .maybeSingle(),
  ]);

  if (appointmentError) throw new Error(appointmentError.message);

  const googleConnected = googleIntegration?.status === 'connected';

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p]));
  const serviceMap = new Map((services ?? []).map((s) => [s.id, s]));
  const editing = editId ? (appointments ?? []).find((a) => a.id === editId) : undefined;
  const returnTo = `/agenda?view=${view}&date=${date}`;
  const ok = typeof params.ok === 'string' ? params.ok : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  const now = Date.now();
  const nextAppointment = view === 'day' && date === todayDate
    ? (appointments ?? []).find((a) => !isCancelled(a.status) && new Date(a.starts_at).getTime() >= now)
    : undefined;

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Agenda</h1>
          <p className="muted" style={{ textTransform: 'capitalize' }}>{periodLabel(view, date)}</p>
        </div>
        <Link className="btn" href={`${returnTo}#turno-form`}>
          <IconPlus /> Nuevo turno
        </Link>
      </div>

      {ok ? <p className="alert success">{ok}</p> : null}
      {error ? <p className="alert error">{error}</p> : null}

      <div className="card">
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="segmented">
            <Link href={`/agenda?view=day&date=${date}`} className={view === 'day' ? 'active' : ''}>Día</Link>
            <Link href={`/agenda?view=week&date=${date}`} className={view === 'week' ? 'active' : ''}>Semana</Link>
            <Link href={`/agenda?view=month&date=${date}`} className={view === 'month' ? 'active' : ''}>Mes</Link>
          </div>

          <div className="date-nav">
            <Link className="date-nav-btn" href={`/agenda?view=${view}&date=${prevDate}`} aria-label="Período anterior">
              <IconChevronLeft />
            </Link>
            <Link className="btn secondary" href={`/agenda?view=${view}&date=${todayDate}`}>Hoy</Link>
            <Link className="date-nav-btn" href={`/agenda?view=${view}&date=${nextDate}`} aria-label="Período siguiente">
              <IconChevronRight />
            </Link>
            <form method="get" className="nav" style={{ marginLeft: 8 }}>
              <input type="hidden" name="view" value={view} />
              <input type="date" name="date" defaultValue={date} />
              <button className="btn secondary" type="submit">Ir</button>
            </form>
          </div>
        </div>
      </div>

      <div className="card" id="turno-form">
        <h2 style={{ marginTop: 0 }}>{editing ? 'Editar / reprogramar turno' : 'Nuevo turno'}</h2>
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

          <div className="form-actions">
            <button className="btn" type="submit">{editing ? 'Guardar cambios' : 'Crear turno'}</button>
            {editing ? <Link className="btn secondary" href={returnTo}>Cancelar edición</Link> : null}
          </div>
        </form>
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          La reconstrucción usa la zona horaria del proyecto: America/Argentina/Buenos_Aires.
        </p>
        {!googleConnected ? (
          <p className="alert" style={{ marginTop: 10, fontSize: 13 }}>
            Para generar enlaces de Google Meet automáticamente en turnos online, conectá tu cuenta de Google en{' '}
            <Link href="/settings#integraciones">Configuración</Link>. Si creás un turno online sin Google conectado, el
            turno se guarda igual pero sin enlace de videollamada.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{view === 'day' ? 'Turnos del día' : view === 'week' ? 'Turnos de la semana' : 'Turnos del mes'}</h2>
        {(appointments ?? []).length === 0 ? (
          <EmptyState title="No hay turnos en este período" description="Cargá un turno nuevo o probá con otra fecha." />
        ) : (
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            {(appointments ?? []).map((a) => {
              const patient = a.patient_id ? patientMap.get(a.patient_id) : undefined;
              const service = a.service_id ? serviceMap.get(a.service_id) : undefined;
              const cancelled = isCancelled(a.status);
              const isNext = nextAppointment?.id === a.id;
              const cardClass = ['appointment-card', isNext ? 'is-next' : '', cancelled ? 'is-cancelled' : ''].filter(Boolean).join(' ');
              const isOnline = a.modality === 'online';

              return (
                <div key={a.id} className={cardClass}>
                  <div className="appointment-main">
                    <div className="appointment-time">
                      {view !== 'day' ? <span className="appointment-date">{formatShortDay(a.starts_at)}</span> : null}
                      {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{patient?.name ?? 'Paciente no disponible'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {service?.name ?? 'Servicio no disponible'} · {a.modality}
                      </div>
                      {isOnline && !cancelled ? (
                        a.meeting_url ? (
                          <div className="nav" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <a className="btn secondary" style={{ padding: '5px 10px', fontSize: 12 }} href={a.meeting_url} target="_blank" rel="noreferrer">
                              Abrir videollamada
                            </a>
                            <input
                              readOnly
                              defaultValue={a.meeting_url}
                              aria-label="Enlace de la videollamada (seleccionar y copiar manualmente)"
                              style={{ fontSize: 12, padding: '5px 8px', width: 220, maxWidth: '100%' }}
                            />
                          </div>
                        ) : (
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            Sin enlace de Meet todavía{!googleConnected ? ' (Google no conectado)' : ''}.
                          </div>
                        )
                      ) : null}
                    </div>
                    {isNext ? <span className="badge badge-confirmado">Próximo</span> : null}
                  </div>

                  <div className="appointment-meta">
                    <span className="muted" style={{ fontSize: 13, minWidth: 90, textAlign: 'right' }}>
                      {a.quoted_amount != null ? `${a.currency ?? 'ARS'} ${Number(a.quoted_amount).toLocaleString('es-AR')}` : '—'}
                    </span>
                    <StatusBadge status={a.status} />
                    {!cancelled ? (
                      <div className="nav" style={{ gap: 10 }}>
                        <Link href={`${returnTo}&edit=${a.id}#turno-form`} className="btn secondary" style={{ padding: '7px 12px', fontSize: 13 }}>
                          Editar
                        </Link>
                        <form action={cancelAppointment}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="return_to" value={returnTo} />
                          <button className="btn danger" type="submit" style={{ padding: '7px 12px', fontSize: 13 }}>
                            Cancelar
                          </button>
                        </form>
                      </div>
                    ) : null}
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
