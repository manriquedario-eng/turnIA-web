import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { cancelAppointment, createAppointment, updateAppointment } from './actions';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconChevronLeft, IconChevronRight, IconClose, IconPlus } from '@/components/ui/icons';
import { AppointmentDateTimeFields } from '@/components/agenda/AppointmentDateTimeFields';
import { PatientCombobox } from '@/components/agenda/PatientCombobox';
import { ModalityField } from '@/components/agenda/ModalityField';

const TZ = 'America/Argentina/Buenos_Aires';
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type AppointmentRow = {
  id: string;
  patient_id: string | null;
  service_id: string | null;
  starts_at: string;
  ends_at: string;
  modality: string | null;
  status: string | null;
  quoted_amount: number | null;
  currency: string | null;
  meeting_provider: string | null;
  meeting_url: string | null;
};

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

// Índice de día de semana con lunes = 0 ... domingo = 6 (para armar grillas
// de calendario que arrancan en lunes, como se pidió).
function mondayIndex(date: string) {
  const value = new Date(`${date}T12:00:00-03:00`);
  return (value.getUTCDay() + 6) % 7;
}

function weekStartOf(date: string) {
  return addDays(date, -mondayIndex(date));
}

function todayInMendoza() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
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
    const start = weekStartOf(date);
    const end = addDays(start, 6);
    const startAnchor = new Date(`${start}T12:00:00-03:00`);
    const endAnchor = new Date(`${end}T12:00:00-03:00`);
    const fmt = (d: Date) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
    return `Semana del ${fmt(startAnchor)} al ${fmt(endAnchor)}`;
  }
  return capitalize(new Intl.DateTimeFormat('es-AR', { timeZone: TZ, month: 'long', year: 'numeric' }).format(anchor));
}

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Arma las semanas completas (lunes a domingo) necesarias para cubrir el
// mes de `date`, incluyendo los días del mes anterior/siguiente que hacen
// falta para completar la grilla.
function buildMonthGrid(date: string) {
  const monthFirst = `${date.slice(0, 7)}-01`;
  const nextMonthFirst = shiftMonth(monthFirst, 1);
  const monthLast = addDays(nextMonthFirst, -1);
  const gridStart = addDays(monthFirst, -mondayIndex(monthFirst));
  const gridEnd = addDays(monthLast, 6 - mondayIndex(monthLast));

  const weeks: string[][] = [];
  let cursor = gridStart;
  let week: string[] = [];
  while (cursor <= gridEnd) {
    week.push(cursor);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor = addDays(cursor, 1);
  }

  return { weeks, gridStart, gridEnd, monthPrefix: date.slice(0, 7) };
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, user, tenantId } = await requireTenant();
  const view = ['day', 'week', 'month'].includes(String(params.view)) ? String(params.view) : 'day';
  const date = isValidDate(params.date) ? params.date : todayInMendoza();
  const editId = typeof params.edit === 'string' ? params.edit : undefined;
  const wantsNew = params.new === '1';
  const slotDate = isValidDate(params.slot) ? params.slot : date;
  const todayDate = todayInMendoza();

  let rangeStart = date;
  let rangeEnd = date;
  let monthGrid: ReturnType<typeof buildMonthGrid> | undefined;
  let weekStart = date;

  if (view === 'week') {
    weekStart = weekStartOf(date);
    rangeStart = weekStart;
    rangeEnd = addDays(weekStart, 6);
  }
  if (view === 'month') {
    monthGrid = buildMonthGrid(date);
    rangeStart = monthGrid.gridStart;
    rangeEnd = monthGrid.gridEnd;
  }

  const prevDate = view === 'day' ? addDays(date, -1) : view === 'week' ? addDays(weekStart, -7) : shiftMonth(date, -1);
  const nextDate = view === 'day' ? addDays(date, 1) : view === 'week' ? addDays(weekStart, 7) : shiftMonth(date, 1);

  const [{ data: appointmentsData, error: appointmentError }, { data: patients }, { data: services }, { data: googleIntegration }] = await Promise.all([
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
  const appointments = (appointmentsData ?? []) as AppointmentRow[];

  const googleConnected = googleIntegration?.status === 'connected';

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p]));
  const serviceMap = new Map((services ?? []).map((s) => [s.id, s]));
  const editing = editId ? appointments.find((a) => a.id === editId) : undefined;
  const showDrawer = Boolean(editing) || wantsNew;
  const drawerDate = editing ? dateKeyInTz(editing.starts_at) : slotDate;
  const [drawerDefaultDate, drawerDefaultTime] = (editing ? dateTimeLocal(editing.starts_at) : `${drawerDate}T09:00`).split('T');
  // Duración ya guardada del turno (si se está editando) — se preserva salvo
  // que la persona elija deliberadamente otro servicio en el drawer.
  const initialDurationMinutes = editing
    ? Math.round((new Date(editing.ends_at).getTime() - new Date(editing.starts_at).getTime()) / 60000)
    : undefined;
  const returnTo = `/agenda?view=${view}&date=${date}`;
  const ok = typeof params.ok === 'string' ? params.ok : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  const now = Date.now();
  const nextAppointment = view === 'day' && date === todayDate
    ? appointments.find((a) => !isCancelled(a.status) && new Date(a.starts_at).getTime() >= now)
    : undefined;

  const appointmentsByDate = new Map<string, AppointmentRow[]>();
  for (const a of appointments) {
    const key = dateKeyInTz(a.starts_at);
    const list = appointmentsByDate.get(key) ?? [];
    list.push(a);
    appointmentsByDate.set(key, list);
  }

  function patientNameOf(a: AppointmentRow) {
    return a.patient_id ? patientMap.get(a.patient_id)?.name ?? 'Sin paciente' : 'Sin paciente';
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Agenda</h1>
          <p className="muted" style={{ textTransform: 'capitalize' }}>{periodLabel(view, date)}</p>
        </div>
        <div className="nav" style={{ flexWrap: 'wrap' }}>
          <Link className="btn secondary" href="/planning">Recurrentes y espera</Link>
          <Link className="btn" href={`${returnTo}&new=1#turno-drawer`}>
            <IconPlus /> Nuevo turno
          </Link>
        </div>
      </div>

      {ok ? <p className="alert success">{ok}</p> : null}
      {error ? <p className="alert error">{error}</p> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '16px 20px' }}>
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

        {view === 'month' && monthGrid ? (
          <div className="month-grid" style={{ border: 'none', borderRadius: 0 }}>
            <div className="month-grid-head">
              {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className="month-grid-body">
              {monthGrid.weeks.flat().map((cellDate) => {
                const dayAppts = appointmentsByDate.get(cellDate) ?? [];
                const isOtherMonth = !cellDate.startsWith(monthGrid!.monthPrefix);
                const isToday = cellDate === todayDate;
                const visible = dayAppts.slice(0, 3);
                const overflowCount = dayAppts.length - visible.length;
                const dayNumber = Number(cellDate.slice(8, 10));
                return (
                  <div
                    key={cellDate}
                    className={['month-cell', isOtherMonth ? 'is-other-month' : '', isToday ? 'is-today' : ''].filter(Boolean).join(' ')}
                  >
                    <Link
                      href={`${returnTo}&new=1&slot=${cellDate}#turno-drawer`}
                      className="month-cell-daynum"
                      aria-label={`Crear turno el ${cellDate}`}
                    >
                      {dayNumber}
                    </Link>
                    <div className="month-cell-appts">
                      {visible.map((a) => (
                        <Link
                          key={a.id}
                          href={`${returnTo}&edit=${a.id}#turno-drawer`}
                          className={`month-chip ${isCancelled(a.status) ? 'is-cancelled' : ''}`}
                          title={`${formatTime(a.starts_at)} · ${patientNameOf(a)}`}
                        >
                          {formatTime(a.starts_at)} {patientNameOf(a)}
                        </Link>
                      ))}
                      {overflowCount > 0 ? (
                        <Link href={`/agenda?view=day&date=${cellDate}`} className="month-chip-more">
                          +{overflowCount} más
                        </Link>
                      ) : null}
                    </div>
                    <Link
                      href={`${returnTo}&new=1&slot=${cellDate}#turno-drawer`}
                      className="month-cell-fill"
                      aria-label={`Crear turno el ${cellDate}`}
                    >
                      {' '}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === 'week' ? (
          <div className="week-grid" style={{ borderTop: '1px solid var(--color-border-soft)', padding: '16px 20px 20px' }}>
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((cellDate) => {
              const dayAppts = appointmentsByDate.get(cellDate) ?? [];
              const isToday = cellDate === todayDate;
              return (
                <div key={cellDate} className={`week-col ${isToday ? 'is-today' : ''}`}>
                  <div className="week-col-head">
                    <span className="week-col-head-label">{formatShortDay(`${cellDate}T12:00:00-03:00`)}</span>
                    <Link
                      href={`${returnTo}&new=1&slot=${cellDate}#turno-drawer`}
                      className="week-col-add"
                      aria-label={`Crear turno el ${cellDate}`}
                    >
                      <IconPlus size={12} />
                    </Link>
                  </div>
                  <div className="week-col-appts">
                    {dayAppts.length === 0 ? (
                      <span className="week-col-empty">Sin turnos</span>
                    ) : (
                      dayAppts.map((a) => (
                        <Link
                          key={a.id}
                          href={`${returnTo}&edit=${a.id}#turno-drawer`}
                          className={`week-chip ${isCancelled(a.status) ? 'is-cancelled' : ''}`}
                        >
                          <span className="week-chip-time">{formatTime(a.starts_at)}</span>
                          <span className="week-chip-name">{patientNameOf(a)}</span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {view === 'day' ? (
          <div style={{ padding: '18px 20px 20px', borderTop: '1px solid var(--color-border-soft)' }}>
            {appointments.length === 0 ? (
              <EmptyState title="No hay turnos en este período" description="Cargá un turno nuevo o probá con otra fecha." />
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {appointments.map((a) => {
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
                            <Link href={`${returnTo}&edit=${a.id}#turno-drawer`} className="btn secondary" style={{ padding: '7px 12px', fontSize: 13 }}>
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
        ) : null}
      </div>

      <div id="turno-drawer">
        {showDrawer ? (
          <>
            <Link href={returnTo} className="drawer-overlay" aria-label="Cerrar panel de turno">{' '}</Link>
            <div className="drawer-panel">
              <div className="drawer-header">
                <h2>{editing ? 'Editar / reprogramar turno' : 'Nuevo turno'}</h2>
                <Link href={returnTo} className="drawer-close" aria-label="Cerrar">
                  <IconClose />
                </Link>
              </div>
              <form action={editing ? updateAppointment : createAppointment} className="drawer-form">
                <input type="hidden" name="return_to" value={returnTo} />
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

                <PatientCombobox
                  key={`patient-${editing?.id ?? `new-${drawerDate}`}`}
                  defaultPatientId={editing?.patient_id ?? undefined}
                  defaultPatientName={editing?.patient_id ? patientMap.get(editing.patient_id)?.name : undefined}
                />

                <AppointmentDateTimeFields
                  key={editing?.id ?? `new-${drawerDate}`}
                  services={(services ?? []).map((s) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes }))}
                  defaultServiceId={editing?.service_id ?? undefined}
                  defaultDate={drawerDefaultDate}
                  defaultTime={drawerDefaultTime}
                  initialDurationMinutes={initialDurationMinutes}
                />

                <ModalityField
                  key={`modality-${editing?.id ?? `new-${drawerDate}`}`}
                  defaultModality={editing?.modality ?? 'presencial'}
                  defaultAmount={editing?.quoted_amount ?? ''}
                  googleConnected={googleConnected}
                />

                <div className="drawer-footer">
                  <button className="btn" type="submit">{editing ? 'Guardar cambios' : 'Crear turno'}</button>
                  <Link className="btn secondary" href={returnTo}>Cancelar</Link>
                </div>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
