import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { cancelAppointment, createAppointment, generateMercadoPagoCheckout, updateAppointment } from './actions';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconChevronLeft, IconChevronRight, IconClose, IconPlus } from '@/components/ui/icons';
import { AppointmentDateTimeFields } from '@/components/agenda/AppointmentDateTimeFields';
import { AppointmentForm } from '@/components/agenda/AppointmentForm';
import { PatientCombobox } from '@/components/agenda/PatientCombobox';
import { ModalityField } from '@/components/agenda/ModalityField';
import { SimpleExportMenu } from '@/components/export/ExportMenu';
import { statusLabel, modalityLabel } from '@/lib/labels';

const TZ = 'America/Argentina/Buenos_Aires';
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type AppointmentRow = {
  id: string;
  patient_id: string | null;
  service_id: string | null;
  professional_id: string | null;
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
    const end = addDays(date, 6);
    const startAnchor = new Date(`${date}T12:00:00-03:00`);
    const endAnchor = new Date(`${end}T12:00:00-03:00`);
    const fmt = (d: Date) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
    return `${fmt(startAnchor)} – ${fmt(endAnchor)}`;
  }
  return capitalize(new Intl.DateTimeFormat('es-AR', { timeZone: TZ, month: 'long', year: 'numeric' }).format(anchor));
}

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

// Acento visual por estado en .appointment-card (ver globals.css) — permite
// escanear la agenda del día sin leer cada badge. Cualquier estado no
// contemplado simplemente no agrega clase (la card queda neutra, como
// antes).
function statusAccentClass(status: string | null) {
  const value = (status ?? '').toLowerCase();
  if (['confirmado', 'confirmed', 'pendiente', 'pending', 'programado', 'scheduled'].includes(value)) {
    return `status-accent-${value}`;
  }
  return '';
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
  // Paciente preseleccionado al venir desde "Nuevo turno" en la ficha del
  // paciente (?patient=<id>). Sólo aplica al crear, nunca pisa el paciente
  // de un turno que se está editando.
  const presetPatientId = typeof params.patient === 'string' ? params.patient : undefined;
  const presetServiceId = typeof params.service === 'string' ? params.service : undefined;
  const presetTime = typeof params.time === 'string' && /^\d{2}:\d{2}$/.test(params.time) ? params.time : undefined;
  const presetModality = typeof params.modality === 'string' && ['presencial', 'domicilio', 'online'].includes(params.modality)
    ? params.modality
    : undefined;
  const presetAmount = typeof params.amount === 'string' && /^\d+(?:\.\d+)?$/.test(params.amount)
    ? params.amount
    : undefined;
  const slotDate = isValidDate(params.slot) ? params.slot : date;
  const todayDate = todayInMendoza();

  let rangeStart = date;
  let rangeEnd = date;
  let monthGrid: ReturnType<typeof buildMonthGrid> | undefined;

  if (view === 'week') {
    // La vista Semana es operativa: arranca en la fecha seleccionada y
    // muestra los 6 días siguientes, sin obligar a retroceder al lunes.
    rangeStart = date;
    rangeEnd = addDays(date, 6);
  }
  if (view === 'month') {
    monthGrid = buildMonthGrid(date);
    rangeStart = monthGrid.gridStart;
    rangeEnd = monthGrid.gridEnd;
  }

  const prevDate = view === 'day' ? addDays(date, -1) : view === 'week' ? addDays(date, -7) : shiftMonth(date, -1);
  const nextDate = view === 'day' ? addDays(date, 1) : view === 'week' ? addDays(date, 7) : shiftMonth(date, 1);

  const [
    { data: appointmentsData, error: appointmentError },
    { data: patients },
    { data: services },
    { data: googleIntegration },
    { data: mercadoPagoIntegration },
  ] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, patient_id, service_id, professional_id, starts_at, ends_at, modality, status, quoted_amount, currency, meeting_provider, meeting_url')
      .eq('tenant_id', tenantId)
      .gte('starts_at', startOfDayIso(rangeStart))
      .lte('starts_at', endOfDayIso(rangeEnd))
      .order('starts_at', { ascending: true }),
    // Sin filtrar por deleted_at: un turno viejo puede pertenecer a un
    // paciente ya archivado, y necesitamos poder mostrar su nombre (con la
    // aclaración de que está archivado) en vez de "Paciente no disponible".
    supabase
      .from('patients')
      .select('id, name, default_price, deleted_at')
      .eq('tenant_id', tenantId)
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
    // Mismo criterio que Google, para Mercado Pago: es sólo indicativo para
    // la UI (mostrar u ocultar el botón) — la verificación real (conexión
    // vigente, revoked_at, token no vencido) vive en
    // lib/mercadopago/orders.ts y se re-chequea siempre server-side al
    // generar el cobro.
    supabase
      .from('integration_status')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'mercadopago')
      .maybeSingle(),
  ]);

  if (appointmentError) throw new Error(appointmentError.message);
  const appointments = (appointmentsData ?? []) as AppointmentRow[];

  const googleConnected = googleIntegration?.status === 'connected';
  const mercadoPagoConnected = mercadoPagoIntegration?.status === 'connected';

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p]));
  const serviceMap = new Map((services ?? []).map((s) => [s.id, s]));
  const editing = editId ? appointments.find((a) => a.id === editId) : undefined;
  const showDrawer = Boolean(editing) || wantsNew;
  const drawerDate = editing ? dateKeyInTz(editing.starts_at) : slotDate;
  const [drawerDefaultDate, drawerDefaultTime] = (editing
    ? dateTimeLocal(editing.starts_at)
    : `${drawerDate}T${presetTime ?? '09:00'}`
  ).split('T');
  // Duración ya guardada del turno (si se está editando) — se preserva salvo
  // que la persona elija deliberadamente otro servicio en el drawer.
  const initialDurationMinutes = editing
    ? Math.round((new Date(editing.ends_at).getTime() - new Date(editing.starts_at).getTime()) / 60000)
    : undefined;

  // Acción de Mercado Pago dentro del turno abierto (drawer de editar /
  // reprogramar) — mismo criterio que ya usa la tarjeta del turno en la
  // lista del día: no cancelado, monto válido (quoted_amount del turno o
  // price del servicio), Mercado Pago conectado, y el turno pertenece al
  // profesional logueado. La verificación real (conexión vigente,
  // revoked_at, amount server-side) siempre se re-hace en
  // lib/mercadopago/orders.ts al generar el cobro — esto es sólo para no
  // mostrar un botón que va a fallar.
  const editingServiceForMp = editing?.service_id ? serviceMap.get(editing.service_id) : undefined;
  const editingAmount = editing
    ? (editing.quoted_amount != null && Number(editing.quoted_amount) > 0 ? Number(editing.quoted_amount) : Number(editingServiceForMp?.price ?? 0))
    : 0;
  const canChargeEditingAppointment = Boolean(
    editing && !isCancelled(editing.status) && mercadoPagoConnected && editingAmount > 0 && editing.professional_id === user.id
  );

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
    if (!a.patient_id) return 'Sin paciente';
    const found = patientMap.get(a.patient_id);
    if (!found) return 'Paciente archivado';
    return found.deleted_at ? `${found.name} (archivado)` : found.name;
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Agenda</h1>
          <p className="muted" style={{ textTransform: 'capitalize' }}>{periodLabel(view, date)}</p>
        </div>
        <div className="nav" style={{ flexWrap: 'wrap' }}>
          <SimpleExportMenu
            buttonLabel="Exportar agenda"
            links={[
              { format: 'pdf', href: `/api/export/agenda?view=${view}&date=${date}&format=pdf` },
              { format: 'docx', href: `/api/export/agenda?view=${view}&date=${date}&format=docx` },
              { format: 'xlsx', href: `/api/export/agenda?view=${view}&date=${date}&format=xlsx` },
            ]}
          />
          <Link className="btn-ghost" href="/planning">Recurrentes y lista de espera</Link>
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
                    <div className="month-cell-head">
                      <span className="month-cell-daynum">{dayNumber}</span>
                      {/* PARTE 1: acción + discreta en CADA celda del mes, igual que en
                          Semana (.week-col-add) — funciona haya o no turnos ese día, y
                          no se confunde con el número del día (que ahora es texto plano,
                          ya no un link). Abre "Nuevo turno" con la fecha de la celda
                          precargada vía ?slot=, mismo mecanismo que ya usa Semana. */}
                      <Link
                        href={`${returnTo}&new=1&slot=${cellDate}#turno-drawer`}
                        className="month-cell-add"
                        aria-label={`Crear turno el ${cellDate}`}
                      >
                        <IconPlus size={12} />
                      </Link>
                    </div>
                    <div className="month-cell-appts">
                      {visible.map((a) => {
                        const isOnline = a.modality === 'online' && !isCancelled(a.status);
                        const hasMeet = isOnline && !!a.meeting_url;
                        return (
                          <div key={a.id} className="month-chip-row">
                            <Link
                              href={`${returnTo}&edit=${a.id}#turno-drawer`}
                              className={`month-chip ${isCancelled(a.status) ? 'is-cancelled' : ''}`}
                              title={`${formatTime(a.starts_at)} · ${patientNameOf(a)}${isOnline ? ' · Online' : ''}`}
                            >
                              {formatTime(a.starts_at)} {patientNameOf(a)}{isOnline ? ' · Online' : ''}
                            </Link>
                            {hasMeet ? (
                              <a
                                href={a.meeting_url!}
                                target="_blank"
                                rel="noreferrer"
                                className="month-chip-meet"
                                aria-label="Abrir Google Meet"
                              >
                                Meet
                              </a>
                            ) : null}
                          </div>
                        );
                      })}
                      {overflowCount > 0 ? (
                        <Link href={`/agenda?view=day&date=${cellDate}`} className="month-chip-more">
                          +{overflowCount} más
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === 'week' ? (
          <div className="week-grid" style={{ borderTop: '1px solid var(--color-border-soft)', padding: '16px 20px 20px' }}>
            {Array.from({ length: 7 }, (_, i) => addDays(date, i)).map((cellDate) => {
              const dayAppts = appointmentsByDate.get(cellDate) ?? [];
              const isToday = cellDate === todayDate;
              // Mismo tope y mismo patrón "+N más" que la vista Mes — una
              // columna con muchos turnos ya no crece indefinidamente ni
              // rompe el layout de la semana.
              const visible = dayAppts.slice(0, 4);
              const overflowCount = dayAppts.length - visible.length;
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
                      <>
                        {visible.map((a) => {
                          const isOnline = a.modality === 'online' && !isCancelled(a.status);
                          const hasMeet = isOnline && !!a.meeting_url;
                          return (
                            <div key={a.id} className="month-chip-row">
                              <Link
                                href={`${returnTo}&edit=${a.id}#turno-drawer`}
                                className={`month-chip ${isCancelled(a.status) ? 'is-cancelled' : ''}`}
                                title={`${formatTime(a.starts_at)} · ${patientNameOf(a)}${isOnline ? ' · Online' : ''}`}
                              >
                                {formatTime(a.starts_at)} {patientNameOf(a)}{isOnline ? ' · Online' : ''}
                              </Link>
                              {hasMeet ? (
                                <a
                                  href={a.meeting_url!}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="month-chip-meet"
                                  aria-label="Abrir Google Meet"
                                >
                                  Meet
                                </a>
                              ) : null}
                            </div>
                          );
                        })}
                        {overflowCount > 0 ? (
                          <Link href={`/agenda?view=day&date=${cellDate}`} className="month-chip-more">
                            +{overflowCount} más
                          </Link>
                        ) : null}
                      </>
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
                  const service = a.service_id ? serviceMap.get(a.service_id) : undefined;
                  const cancelled = isCancelled(a.status);
                  const isNext = nextAppointment?.id === a.id;
                  const cardClass = ['appointment-card', isNext ? 'is-next' : '', cancelled ? 'is-cancelled' : '', statusAccentClass(a.status)].filter(Boolean).join(' ');
                  const isOnline = a.modality === 'online';

                  // Botón de Mercado Pago: sólo si el turno no está
                  // cancelado, tiene un monto > 0, MP está conectado para
                  // este profesional y el turno le pertenece (mismo chequeo
                  // que hace lib/mercadopago/orders.ts server-side — esto es
                  // sólo para no mostrar un botón que va a fallar). Un único
                  // botón: el click siempre pasa por generateMercadoPagoCheckout,
                  // que reutiliza el checkout existente si lo hay o genera uno
                  // nuevo, y redirige de una al checkout_url — nunca hay una
                  // pantalla intermedia de "cobro generado" con un segundo
                  // botón "Abrir Mercado Pago".
                  const appointmentAmount = a.quoted_amount != null && Number(a.quoted_amount) > 0 ? Number(a.quoted_amount) : Number(service?.price ?? 0);
                  const canGenerateMercadoPagoCheckout =
                    !cancelled && mercadoPagoConnected && appointmentAmount > 0 && a.professional_id === user.id;

                  return (
                    <div key={a.id} className={cardClass}>
                      <div className="appointment-main">
                        <div className="appointment-time">
                          {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{patientNameOf(a)}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {service?.name ?? 'Servicio no disponible'} · {modalityLabel(a.modality)}
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
                        <span className="appointment-amount">
                          {a.quoted_amount != null ? `${a.currency ?? 'ARS'} ${Number(a.quoted_amount).toLocaleString('es-AR')}` : '—'}
                        </span>
                        <StatusBadge status={a.status} label={statusLabel(a.status)} />
                        {!cancelled ? (
                          <div className="appointment-row-actions">
                            <Link href={`${returnTo}&edit=${a.id}#turno-drawer`} className="btn-ghost">
                              Editar
                            </Link>
                            <form action={cancelAppointment}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="return_to" value={returnTo} />
                              <button className="btn-ghost danger" type="submit">
                                Cancelar
                              </button>
                            </form>
                            {canGenerateMercadoPagoCheckout ? (
                              <form action={generateMercadoPagoCheckout}>
                                <input type="hidden" name="appointment_id" value={a.id} />
                                <input type="hidden" name="return_to" value={returnTo} />
                                <button className="btn-ghost" type="submit" style={{ fontSize: 13 }}>
                                  Cobrar con Mercado Pago
                                </button>
                              </form>
                            ) : null}
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
              <AppointmentForm
                action={editing ? updateAppointment : createAppointment}
                submitLabel={editing ? 'Guardar cambios' : 'Crear turno'}
                cancelHref={returnTo}
              >
                <input type="hidden" name="return_to" value={returnTo} />
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

                <PatientCombobox
                  key={`patient-${editing?.id ?? `new-${drawerDate}`}`}
                  defaultPatientId={editing?.patient_id ?? (!editing ? presetPatientId : undefined)}
                  defaultPatientName={
                    editing?.patient_id
                      ? patientMap.get(editing.patient_id)?.name
                      : (!editing && presetPatientId ? patientMap.get(presetPatientId)?.name : undefined)
                  }
                />

                <AppointmentDateTimeFields
                  key={editing?.id ?? `new-${drawerDate}`}
                  services={(services ?? []).map((s) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes }))}
                  defaultServiceId={editing?.service_id ?? (!editing ? presetServiceId : undefined)}
                  defaultDate={drawerDefaultDate}
                  defaultTime={drawerDefaultTime}
                  initialDurationMinutes={initialDurationMinutes}
                />

                <ModalityField
                  key={`modality-${editing?.id ?? `new-${drawerDate}`}`}
                  defaultModality={editing?.modality ?? (!editing ? presetModality : undefined) ?? 'presencial'}
                  defaultAmount={editing?.quoted_amount ?? (!editing ? presetAmount : undefined) ?? ''}
                  googleConnected={googleConnected}
                />
              </AppointmentForm>

              {/* PARTE 2: acción de Mercado Pago dentro del turno abierto.
                  Deliberadamente FUERA de <AppointmentForm> (que ya es su
                  propio <form> de editar/reprogramar) — un <form> no puede
                  anidar otro <form>, y esto tiene su propia server action
                  independiente, para no tocar en nada el submit de editar.
                  Un único click: generateMercadoPagoCheckout reutiliza el
                  checkout existente o genera uno nuevo y redirige de una al
                  checkout_url, nunca un flujo "Generar" -> "Abrir". No se
                  muestra si el turno está cancelado (canChargeEditingAppointment
                  ya lo excluye). */}
              {canChargeEditingAppointment && editing ? (
                <form action={generateMercadoPagoCheckout} className="drawer-footer" style={{ paddingTop: 0 }}>
                  <input type="hidden" name="appointment_id" value={editing.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className="btn secondary" type="submit" style={{ width: '100%' }}>
                    Cobrar con Mercado Pago
                  </button>
                </form>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
