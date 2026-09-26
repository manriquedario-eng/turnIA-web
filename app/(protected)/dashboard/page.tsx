import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { statusLabel, modalityLabel } from '@/lib/labels';
import { resolveDisplayName } from '@/lib/identity';
import { setReminderStatus } from '@/app/(protected)/reminders/actions';
import { IconCheck, IconPlus, IconLeaf, IconChevronRight } from '@/components/ui/icons';

// PARTE 5 del pedido: todo bloque del Dashboard que representa un recurso
// existente (turno, paciente, pago pendiente, lista de espera, aviso) debe
// ser accionable — nunca texto muerto con apariencia de botón/aviso.
function appointmentHref(today: string, appointmentId: string) {
  return `/agenda?view=day&date=${today}&edit=${appointmentId}#turno-drawer`;
}

const TZ = 'America/Argentina/Buenos_Aires';

function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nextLocalDay(date: string) {
  const anchor = new Date(`${date}T12:00:00-03:00`);
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(anchor);
}

function dashboardGreetingName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return displayName;
  if (parts.length >= 2 && /^(lic\.?|dr\.?|dra\.?|prof\.?)$/i.test(parts[0])) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

function dayRange(date: string) {
  return {
    start: new Date(`${date}T00:00:00-03:00`).toISOString(),
    end: new Date(`${date}T23:59:59.999-03:00`).toISOString(),
  };
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function formatReminderDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function isConfirmedLike(status: string | null) {
  const value = (status ?? '').toLowerCase();
  return value === 'confirmado' || value === 'confirmed';
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()),
  );
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// Puramente de presentación (redondeo simple del delta entre ahora y el
// inicio del turno ya calculado) — no es un dato nuevo, sólo un formato
// distinto de algo que ya se muestra como hora exacta en la lista.
function formatRelativeStart(iso: string, now: Date) {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `En ${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `En ${hours}h ${mins}min` : `En ${hours}h`;
}

export default async function DashboardPage() {
  const { supabase, tenantId, user } = await requireTenant();
  const today = todayLocal();
  const tomorrow = nextLocalDay(today);
  const { start, end } = dayRange(today);
  const { end: tomorrowEnd } = dayRange(tomorrow);
  const now = new Date();

  const [
    profileResult,
    appointmentsResult,
    paymentsResult,
    cashResult,
    waitlistResult,
    remindersResult,
    notificationsResult,
  ] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('appointments')
      .select('id, patient_id, service_id, starts_at, ends_at, status, modality, quoted_amount, currency, patients(name), services(name)')
      .eq('tenant_id', tenantId)
      .gte('starts_at', start)
      .lte('starts_at', tomorrowEnd)
      .order('starts_at', { ascending: true }),
    supabase
      .from('payments')
      .select('amount')
      .eq('tenant_id', tenantId)
      .gte('created_at', start)
      .lte('created_at', end),
    supabase
      .from('cash_movements')
      .select('amount, kind')
      .eq('tenant_id', tenantId)
      .gte('created_at', start)
      .lte('created_at', end),
    supabase
      .from('waitlist_entries')
      .select('id, patient_id, service_id, preferred_day, preferred_time, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(5),
    // PARTE 7-8 del pedido: recordatorios personales del profesional,
    // sólo los propios (filtro explícito además de la RLS — ver
    // reminders/actions.ts). Sólo pendientes acá; "realizados" vive en
    // /reminders.
    supabase
      .from('professional_reminders')
      .select('id, title, description, remind_at, status')
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .eq('status', 'pending')
      .order('remind_at', { ascending: true })
      .limit(20),
    supabase
      .from('appointment_action_alerts')
      .select('id,action,created_at,read_at,appointment_id,patient_id,patients(name),appointments(starts_at)')
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const allAppointments = appointmentsResult.data ?? [];
  const appointments = allAppointments.filter((item) => dateKeyInTz(item.starts_at) === today);
  const tomorrowAppointments = allAppointments.filter((item) => dateKeyInTz(item.starts_at) === tomorrow);
  const dashboardTodayAppointments = appointments.filter((item) => new Date(item.starts_at).getTime() >= now.getTime());
  const activeAppointments = appointments.filter((item) => !isCancelled(item.status));
  const activeTomorrowAppointments = tomorrowAppointments.filter((item) => !isCancelled(item.status));
  const cancelledAppointments = appointments.filter((item) => isCancelled(item.status));
  const confirmedAppointments = activeAppointments.filter((item) => isConfirmedLike(item.status));
  const collectedToday = (paymentsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const cashToday = (cashResult.data ?? []).reduce((sum, row) => {
    const amount = Number(row.amount ?? 0);
    return sum + (row.kind === 'in' ? amount : -amount);
  }, 0);

  const todayApptIds = appointments.map((item) => item.id);
  const paymentsByAppointmentResult = todayApptIds.length
    ? await supabase
        .from('payments')
        .select('appointment_id, amount')
        .eq('tenant_id', tenantId)
        .in('appointment_id', todayApptIds)
    : { data: [] as { appointment_id: string; amount: number }[] };

  const paidByAppointment = new Map<string, number>();
  for (const row of paymentsByAppointmentResult.data ?? []) {
    paidByAppointment.set(row.appointment_id, (paidByAppointment.get(row.appointment_id) ?? 0) + Number(row.amount ?? 0));
  }
  const pendingToday = activeAppointments.reduce((sum, item) => {
    const quoted = Number(item.quoted_amount ?? 0);
    const paid = paidByAppointment.get(item.id) ?? 0;
    return sum + Math.max(quoted - paid, 0);
  }, 0);

  const nextAppointment = [...activeAppointments, ...activeTomorrowAppointments]
    .find((item) => new Date(item.starts_at).getTime() >= now.getTime());
  const waitlist = waitlistResult.data ?? [];

  const waitlistPatientIds = [...new Set(waitlist.map((entry) => entry.patient_id).filter(Boolean))];
  const waitlistServiceIds = [...new Set(waitlist.map((entry) => entry.service_id).filter(Boolean))];
  const [waitlistPatientsResult, waitlistServicesResult] = await Promise.all([
    waitlistPatientIds.length
      ? supabase.from('patients').select('id, name').eq('tenant_id', tenantId).in('id', waitlistPatientIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    waitlistServiceIds.length
      ? supabase.from('services').select('id, name').eq('tenant_id', tenantId).in('id', waitlistServiceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const waitlistPatientMap = new Map((waitlistPatientsResult.data ?? []).map((p) => [p.id, p.name]));
  const waitlistServiceMap = new Map((waitlistServicesResult.data ?? []).map((s) => [s.id, s.name]));

  const displayName = resolveDisplayName(profileResult.data?.display_name, user.email);
  const firstName = dashboardGreetingName(displayName);

  // Si la migración de professional_reminders todavía no se aplicó en esta
  // base, remindersResult.error viene seteado (tabla inexistente) — se trata
  // como "sin recordatorios todavía" en vez de romper el Dashboard entero.
  const reminders = (remindersResult.error ? [] : remindersResult.data ?? []) as {
    id: string;
    title: string;
    description: string | null;
    remind_at: string;
    status: string;
  }[];
  const reminderOverdue = reminders.filter((r) => new Date(r.remind_at).getTime() < now.getTime());
  const reminderToday = reminders.filter((r) => new Date(r.remind_at).getTime() >= now.getTime() && dateKeyInTz(r.remind_at) === today);
  const reminderUpcoming = reminders.filter((r) => new Date(r.remind_at).getTime() >= now.getTime() && dateKeyInTz(r.remind_at) !== today);
  const remindersToShow = [...reminderOverdue, ...reminderToday, ...reminderUpcoming].slice(0, 5);
  const notifications = (notificationsResult.error ? [] : notificationsResult.data ?? []) as any[];
  const unreadNotifications = notifications.filter((item) => !item.read_at).length;

  // PARTE 5: cada aviso de "Pendientes y oportunidades" referencia un
  // recurso real (turnos cancelados de hoy, cobros pendientes, lista de
  // espera) — así que cada uno lleva a la sección correspondiente en vez de
  // ser texto suelto.
  const opportunities: { text: string; href: string }[] = [];
  if (cancelledAppointments.length > 0) {
    opportunities.push({
      text: `${cancelledAppointments.length} turno${cancelledAppointments.length === 1 ? '' : 's'} cancelado${cancelledAppointments.length === 1 ? '' : 's'} hoy: podés ofrecer ese horario a alguien en lista de espera.`,
      href: '/planning#lista-de-espera',
    });
  }
  if (pendingToday > 0) {
    opportunities.push({
      text: `Tenés $${pendingToday.toLocaleString('es-AR')} pendiente de cobro por los turnos de hoy.`,
      href: '/payments',
    });
  }
  if (waitlist.length > 0) {
    opportunities.push({
      text: `${waitlist.length} paciente${waitlist.length === 1 ? '' : 's'} esperando disponibilidad.`,
      href: '/planning#lista-de-espera',
    });
  }
  if (appointments.length === 0) {
    opportunities.push({
      text: 'No tenés turnos cargados para hoy. Podés crear uno o revisar la lista de espera.',
      href: `/agenda?view=day&date=${today}&new=1#turno-drawer`,
    });
  }

  return (
    <section className="stack">
      {/* Concepto C (blueprint): saludo editorial grande con ícono de hoja,
          fecha + una frase corta a la derecha a modo de "quote" — igual
          composición que la referencia aprobada. Ningún dato nuevo. */}
      <div className="dashboard-header-row">
        <div className="dashboard-greeting">
          <span className="icon-circle">
            <IconLeaf size={18} />
          </span>
          <div>
            <h1 className="dashboard-hero">Hola, {firstName}</h1>
            <p className="muted" style={{ marginTop: 2 }}>Un nuevo día para organizar tu consultorio.</p>
          </div>
        </div>
        <div className="dashboard-header-side">
          <div className="dashboard-header-date" style={{ textTransform: 'capitalize' }}>
            {new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date())}
          </div>
          <div className="dashboard-quote">
            <span className="dashboard-quote-dot" aria-hidden="true" />
            "Pequeñas organizaciones hacen grandes jornadas."
          </div>
        </div>
        <div className="nav" style={{ flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
          <Link className="btn" href={`/agenda?view=day&date=${today}`}><IconPlus size={14} /> Nuevo turno</Link>
          <Link className="btn secondary" href="/patients">Nuevo paciente</Link>
        </div>
      </div>

      {/* Franja de métricas — tarjetas verticales con ícono-círculo, número
          grande y flecha de acceso, como en la referencia. Mismos 3 datos
          de siempre (turnos/cobrado/pendiente) — ningún dato nuevo. */}
      <div className="dashboard-metrics-grid">
        <Link href={`/agenda?view=day&date=${today}`} className="dashboard-metric-card">
          <span className="icon-circle">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </span>
          <span className="dashboard-metric-copy">
            <span className="dashboard-metric-value">{activeAppointments.length}</span>
            <span className="dashboard-metric-label">
              Turnos de hoy · {confirmedAppointments.length} confirmado{confirmedAppointments.length === 1 ? '' : 's'}
              {cancelledAppointments.length > 0 ? ` · ${cancelledAppointments.length} cancelado${cancelledAppointments.length === 1 ? '' : 's'}` : ''}
            </span>
          </span>
          <span className="dashboard-metric-card-foot">
            <span />
            <span className="dashboard-metric-arrow"><IconChevronRight size={14} /></span>
          </span>
        </Link>

        <Link href="/payments" className="dashboard-metric-card">
          <span className="icon-circle is-lilac">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          <span className="dashboard-metric-copy">
            <span className="dashboard-metric-value">${collectedToday.toLocaleString('es-AR')}</span>
            <span className="dashboard-metric-label">Cobrado hoy</span>
          </span>
          <span className="dashboard-metric-card-foot">
            <span />
            <span className="dashboard-metric-arrow"><IconChevronRight size={14} /></span>
          </span>
        </Link>

        <Link href="/payments" className="dashboard-metric-card">
          <span className="icon-circle is-sand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
          </span>
          <span className="dashboard-metric-copy">
            <span className={`dashboard-metric-value ${pendingToday > 0 ? 'is-pending' : ''}`}>${pendingToday.toLocaleString('es-AR')}</span>
            <span className="dashboard-metric-label">Pendiente de cobro</span>
          </span>
          <span className="dashboard-metric-card-foot">
            <span />
            <span className="dashboard-metric-arrow"><IconChevronRight size={14} /></span>
          </span>
        </Link>
      </div>

      {/* "Requiere atención" — mismos datos (opportunities), sin ningún
          cálculo nuevo. */}
      {opportunities.length > 0 ? (
        <div className="dashboard-attention">
          <div className="dashboard-attention-title">Requiere atención</div>
          <ul className="dashboard-opportunities" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {opportunities.map((item) => (
              <li key={item.text}>
                <Link href={item.href} className="dashboard-opportunity-link">
                  <span>{item.text}</span>
                  <span className="timeline-item-chevron" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Composición en 3 columnas (Agenda de hoy / Próximo turno +
          Recordatorios + Lista de espera / panel editorial), tal como en la
          referencia aprobada. */}
      <div className="dashboard-columns">
        <div className="dashboard-col">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap', padding: '18px 20px 0' }}>
              <h2>Agenda de hoy</h2>
              <Link className="text-helper" href={`/agenda?view=day&date=${today}`}>Ver agenda completa →</Link>
            </div>

            {appointments.length === 0 ? (
              <div style={{ padding: '0 20px 20px' }}>
                <EmptyState title="No hay turnos registrados para hoy" description="Cuando crees un turno para hoy, va a aparecer acá." />
              </div>
            ) : (
              <div className="stack" style={{ gap: 8, padding: '14px 20px 20px' }}>
                {appointments.map((appointment: any) => {
                  const cancelled = isCancelled(appointment.status);
                  const isNext = nextAppointment?.id === appointment.id;
                  const confirmed = isConfirmedLike(appointment.status);
                  const dotClass = cancelled ? 'is-cancelled' : confirmed ? 'is-confirmed' : '';
                  const cardClass = ['appointment-card', isNext ? 'is-next' : '', cancelled ? 'is-cancelled' : '', !cancelled ? 'appointment-card-link' : ''].filter(Boolean).join(' ');
                  const inner = (
                    <>
                      <div className="appointment-main">
                        <span className={`dashboard-dot ${dotClass}`} aria-hidden="true" />
                        <div className="appointment-time">{formatTime(appointment.starts_at)}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{appointment.patients?.name ?? 'Sin paciente'}</div>
                          <div className="text-helper">
                            {appointment.services?.name ?? 'Sin servicio'} · {modalityLabel(appointment.modality)}
                          </div>
                        </div>
                        {isNext ? <span className="badge badge-confirmado">Próximo</span> : null}
                      </div>
                      <div className="appointment-meta">
                        <span className="muted" style={{ fontSize: 13 }}>
                          {appointment.quoted_amount != null ? `${appointment.currency ?? 'ARS'} ${Number(appointment.quoted_amount).toLocaleString('es-AR')}` : '—'}
                        </span>
                        <StatusBadge status={appointment.status} label={statusLabel(appointment.status)} />
                        {!cancelled ? <span className="timeline-item-chevron" aria-hidden="true">›</span> : null}
                      </div>
                    </>
                  );
                  // Turno no cancelado → toda la fila es un link a la agenda (editar
                  // ese turno concreto). Cancelado → sin acción (no se puede editar).
                  return cancelled ? (
                    <div key={appointment.id} className={cardClass}>{inner}</div>
                  ) : (
                    <Link key={appointment.id} href={appointmentHref(today, appointment.id)} className={cardClass}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap', padding: '18px 20px 0' }}>
              <h2>Agenda de mañana</h2>
              <Link className="text-helper" href={`/agenda?view=day&date=${tomorrow}`}>Ver agenda completa →</Link>
            </div>

            {tomorrowAppointments.length === 0 ? (
              <div style={{ padding: '0 20px 20px' }}>
                <EmptyState title="No hay turnos registrados para mañana" description="Cuando haya turnos para mañana, van a aparecer acá." />
              </div>
            ) : (
              <div className="stack" style={{ gap: 8, padding: '14px 20px 20px' }}>
                {tomorrowAppointments.map((appointment: any) => {
                  const cancelled = isCancelled(appointment.status);
                  const isNext = nextAppointment?.id === appointment.id;
                  const confirmed = isConfirmedLike(appointment.status);
                  const dotClass = cancelled ? 'is-cancelled' : confirmed ? 'is-confirmed' : '';
                  const cardClass = ['appointment-card', isNext ? 'is-next' : '', cancelled ? 'is-cancelled' : '', !cancelled ? 'appointment-card-link' : ''].filter(Boolean).join(' ');
                  const inner = (
                    <>
                      <div className="appointment-main">
                        <span className={`dashboard-dot ${dotClass}`} aria-hidden="true" />
                        <div className="appointment-time">{formatTime(appointment.starts_at)}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{appointment.patients?.name ?? 'Sin paciente'}</div>
                          <div className="text-helper">
                            {appointment.services?.name ?? 'Sin servicio'} · {modalityLabel(appointment.modality)}
                          </div>
                        </div>
                        {isNext ? <span className="badge badge-confirmado">Próximo</span> : null}
                      </div>
                      <div className="appointment-meta">
                        <span className="muted" style={{ fontSize: 13 }}>
                          {appointment.quoted_amount != null ? `${appointment.currency ?? 'ARS'} ${Number(appointment.quoted_amount).toLocaleString('es-AR')}` : '—'}
                        </span>
                        <StatusBadge status={appointment.status} label={statusLabel(appointment.status)} />
                        {!cancelled ? <span className="timeline-item-chevron" aria-hidden="true">›</span> : null}
                      </div>
                    </>
                  );

                  return cancelled ? (
                    <div key={appointment.id} className={cardClass}>{inner}</div>
                  ) : (
                    <Link key={appointment.id} href={appointmentHref(tomorrow, appointment.id)} className={cardClass}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-col">
          {/* "Próximo turno" — panel destacado propio, card blanca limpia
              con avatar de iniciales, badge de tiempo relativo y CTA — igual
              que en la referencia. Mismos datos ya calculados
              (nextAppointment), sin ninguna consulta ni lógica nueva. */}
          {nextAppointment ? (
            <Link href={appointmentHref(dateKeyInTz(nextAppointment.starts_at), nextAppointment.id)} className="dashboard-next-panel">
              <span className="dashboard-next-panel-avatar">
                {((nextAppointment as any).patients?.name ?? '—').trim().slice(0, 2).toUpperCase()}
              </span>
              <span className="dashboard-next-panel-copy">
                <span className="dashboard-next-panel-head">
                  <span className="dashboard-next-panel-eyebrow">Próximo turno</span>
                  <span className="dashboard-pill">{formatRelativeStart(nextAppointment.starts_at, now)}</span>
                </span>
                <span className="dashboard-next-panel-name">{(nextAppointment as any).patients?.name ?? 'Sin paciente'}</span>
                <span className="dashboard-next-panel-meta">
                  {(nextAppointment as any).services?.name ?? 'Sin servicio'} · {formatTime(nextAppointment.starts_at)}
                </span>
              </span>
              <span className="btn secondary btn-compact dashboard-next-panel-action">Ver paciente</span>
            </Link>
          ) : null}

          {/* Recordatorios — checklist compacto, checkbox a la izquierda,
              mismos datos/acción (setReminderStatus) de siempre. */}
          <div className="card">
            <div className="nav" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Recordatorios
                {reminders.length > 0 ? <span className="dashboard-pill">{reminders.length}</span> : null}
              </h2>
              <Link className="text-helper" href="/reminders">Ver todos →</Link>
            </div>
            {remindersToShow.length === 0 ? (
              <p className="text-helper" style={{ margin: '8px 0 0' }}>Sin recordatorios pendientes.</p>
            ) : (
              <ul className="dashboard-checklist">
                {remindersToShow.map((reminder) => {
                  const overdue = new Date(reminder.remind_at).getTime() < now.getTime();
                  const isToday = dateKeyInTz(reminder.remind_at) === today;
                  return (
                    <li key={reminder.id} className={`dashboard-checklist-row ${overdue ? 'is-overdue' : isToday ? 'is-today' : ''}`}>
                      <form action={setReminderStatus}>
                        <input type="hidden" name="id" value={reminder.id} />
                        <input type="hidden" name="status" value="done" />
                        <input type="hidden" name="return_to" value="/dashboard" />
                        <button className="icon-btn is-sm" type="submit" aria-label="Marcar como realizado" title="Marcar como realizado">
                          <IconCheck size={12} />
                        </button>
                      </form>
                      <Link href={`/reminders?edit=${reminder.id}`} className="dashboard-reminder-link" style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{reminder.title}</div>
                        <div className="text-helper">
                          {overdue ? 'Vencido · ' : isToday ? 'Hoy · ' : ''}
                          {formatReminderDateTime(reminder.remind_at)}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="nav" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Notificaciones
                {unreadNotifications > 0 ? <span className="dashboard-pill">{unreadNotifications}</span> : null}
              </h2>
              <Link className="text-helper" href="/notifications">Ver todas →</Link>
            </div>

            {notifications.length === 0 ? (
              <p className="text-helper" style={{ margin: '8px 0 0' }}>Sin notificaciones todavía.</p>
            ) : (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {notifications.map((notification) => {
                  const title =
                    notification.action === 'confirm'
                      ? 'Turno confirmado'
                      : notification.action === 'cancel'
                        ? 'Turno cancelado'
                        : 'Solicitud de reprogramación';
                  const patientName = notification.patients?.name ?? 'Paciente';
                  const appointmentStartsAt = notification.appointments?.starts_at as string | undefined;
                  const href = appointmentStartsAt
                    ? appointmentHref(dateKeyInTz(appointmentStartsAt), notification.appointment_id)
                    : '/notifications';

                  return (
                    <Link
                      key={notification.id}
                      href={href}
                      className={`dashboard-notification-row ${notification.read_at ? '' : 'is-unread'}`}
                    >
                      <span className={`dashboard-dot ${notification.action === 'confirm' ? 'is-confirmed' : notification.action === 'cancel' ? 'is-cancelled' : 'is-reschedule'}`} aria-hidden="true" />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{title}</span>
                        <span className="text-helper">{patientName} · {formatReminderDateTime(notification.created_at)}</span>
                      </span>
                      <span className="timeline-item-chevron" aria-hidden="true">›</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lista de espera — funcionalidad existente (no aparece en la
              referencia, que no contempla este bloque), mantenida como
              tercera card del mismo estilo para no perder nada de lo que
              ya funciona. */}
          {waitlist.length > 0 ? (
            <div className="card">
              <div className="nav" style={{ justifyContent: 'space-between' }}>
                <h2>Lista de espera</h2>
                <Link className="text-helper" href="/planning">Ver todo →</Link>
              </div>
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {waitlist.map((entry) => (
                  <Link
                    key={entry.id}
                    href="/planning#lista-de-espera"
                    className="dashboard-waitlist-row"
                    aria-label={`Ver en lista de espera: ${waitlistPatientMap.get(entry.patient_id) ?? 'Paciente no disponible'}`}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {waitlistPatientMap.get(entry.patient_id) ?? 'Paciente no disponible'}
                      </div>
                      <div className="text-helper">
                        {entry.service_id ? waitlistServiceMap.get(entry.service_id) ?? 'Servicio no disponible' : 'Cualquier servicio'}
                        {entry.preferred_day || entry.preferred_time
                          ? ` · ${[entry.preferred_day, entry.preferred_time].filter(Boolean).join(' ')}`
                          : ''}
                      </div>
                    </div>
                    <span className="timeline-item-chevron" aria-hidden="true">›</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>

      </div>
    </section>
  );
}
