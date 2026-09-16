import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { statusLabel, modalityLabel } from '@/lib/labels';
import { resolveDisplayName } from '@/lib/identity';
import { setReminderStatus } from '@/app/(protected)/reminders/actions';
import { IconCheck } from '@/components/ui/icons';

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

export default async function DashboardPage() {
  const { supabase, tenantId, user } = await requireTenant();
  const today = todayLocal();
  const { start, end } = dayRange(today);
  const now = new Date();

  const [
    profileResult,
    appointmentsResult,
    paymentsResult,
    cashResult,
    waitlistResult,
    remindersResult,
  ] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('appointments')
      .select('id, patient_id, service_id, starts_at, ends_at, status, modality, quoted_amount, currency, patients(name), services(name)')
      .eq('tenant_id', tenantId)
      .gte('starts_at', start)
      .lte('starts_at', end)
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
  ]);

  const appointments = appointmentsResult.data ?? [];
  const activeAppointments = appointments.filter((item) => !isCancelled(item.status));
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

  const nextAppointment = activeAppointments.find((item) => new Date(item.starts_at).getTime() >= now.getTime());
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
      <div className="page-header">
        <div>
          <h1>{greeting()}, {displayName}</h1>
          <p className="muted" style={{ textTransform: 'capitalize' }}>
            {new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date())}
          </p>
        </div>
        <div className="nav" style={{ flexWrap: 'wrap' }}>
          <Link className="btn" href={`/agenda?view=day&date=${today}`}>Nuevo turno</Link>
          <Link className="btn-ghost" href="/patients">Nuevo paciente</Link>
          <Link className="btn-ghost" href="/payments">Registrar cobro</Link>
          <Link className="btn-ghost" href="/reminders">Nuevo recordatorio</Link>
          <Link className="btn-ghost" href={`/agenda?view=day&date=${today}`}>Ver agenda</Link>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="stat-strip-label">Turnos de hoy</span>
          <span className="stat-strip-value">{activeAppointments.length}</span>
          <span className="stat-strip-hint">{confirmedAppointments.length} confirmados</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Cancelados hoy</span>
          <span className="stat-strip-value">{cancelledAppointments.length}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Cobrado hoy</span>
          <span className="stat-strip-value">${collectedToday.toLocaleString('es-AR')}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">Pendiente de cobro</span>
          <span className="stat-strip-value">${pendingToday.toLocaleString('es-AR')}</span>
        </div>
      </div>

      <div className="split-main-side">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="nav" style={{ justifyContent: 'space-between', flexWrap: 'wrap', padding: '18px 20px 0' }}>
            <h2 style={{ marginTop: 0 }}>Agenda de hoy</h2>
            <Link className="btn secondary" href={`/agenda?view=day&date=${today}`}>Abrir agenda</Link>
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
                const cardClass = ['appointment-card', isNext ? 'is-next' : '', cancelled ? 'is-cancelled' : '', !cancelled ? 'appointment-card-link' : ''].filter(Boolean).join(' ');
                const inner = (
                  <>
                    <div className="appointment-main">
                      <div className="appointment-time">{formatTime(appointment.starts_at)}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{appointment.patients?.name ?? 'Sin paciente'}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
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

        <div className="stack">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Próximo paciente</h2>
            {nextAppointment ? (
              <Link href={appointmentHref(today, nextAppointment.id)} className="dashboard-next-link">
                <div className="stack" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 20 }}>{formatTime(nextAppointment.starts_at)}</strong>
                  <div style={{ fontWeight: 600 }}>{(nextAppointment as any).patients?.name ?? 'Sin paciente'}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {(nextAppointment as any).services?.name ?? 'Sin servicio'} · {modalityLabel(nextAppointment.modality)}
                  </div>
                  <div className="nav" style={{ justifyContent: 'space-between' }}>
                    <StatusBadge status={nextAppointment.status} label={statusLabel(nextAppointment.status)} />
                    <span className="timeline-item-chevron" aria-hidden="true">›</span>
                  </div>
                </div>
              </Link>
            ) : (
              <EmptyState title="No hay más turnos hoy" description="Ya pasaron todos los turnos activos del día." />
            )}
          </div>

          <div className="card">
            <div className="nav" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ marginTop: 0 }}>Lista de espera</h2>
              <Link className="muted" style={{ fontSize: 12 }} href="/planning">Ver todo →</Link>
            </div>
            {waitlist.length === 0 ? (
              <EmptyState title="Sin pacientes en espera" description="Cuando agregues alguien, va a aparecer acá." />
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {waitlist.map((entry) => (
                  <Link
                    key={entry.id}
                    href="/planning#lista-de-espera"
                    className="dashboard-waitlist-row"
                    style={{ paddingBottom: 8, borderBottom: '1px solid var(--color-border-soft)' }}
                    aria-label={`Ver en lista de espera: ${waitlistPatientMap.get(entry.patient_id) ?? 'Paciente no disponible'}`}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {waitlistPatientMap.get(entry.patient_id) ?? 'Paciente no disponible'}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
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
            )}
          </div>

          <div className="card">
            <div className="nav" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ marginTop: 0 }}>Recordatorios</h2>
              <Link className="muted" style={{ fontSize: 12 }} href="/reminders">Ver todos →</Link>
            </div>
            {remindersToShow.length === 0 ? (
              <EmptyState title="Sin recordatorios pendientes" description="Tu agenda personal — llamadas, trámites, lo que necesites no olvidar." />
            ) : (
              <ul className="dashboard-reminder-list">
                {remindersToShow.map((reminder) => {
                  const overdue = new Date(reminder.remind_at).getTime() < now.getTime();
                  const isToday = dateKeyInTz(reminder.remind_at) === today;
                  return (
                    <li key={reminder.id} className={`dashboard-reminder-row ${overdue ? 'is-overdue' : isToday ? 'is-today' : ''}`}>
                      <Link href={`/reminders?edit=${reminder.id}`} className="dashboard-reminder-link">
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{reminder.title}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {overdue ? 'Vencido · ' : isToday ? 'Hoy · ' : ''}
                            {formatReminderDateTime(reminder.remind_at)}
                          </div>
                        </div>
                      </Link>
                      <form action={setReminderStatus}>
                        <input type="hidden" name="id" value={reminder.id} />
                        <input type="hidden" name="status" value="done" />
                        <input type="hidden" name="return_to" value="/dashboard" />
                        <button className="btn-ghost" type="submit" aria-label="Marcar como realizado" title="Marcar como realizado">
                          <IconCheck size={14} />
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Pendientes y oportunidades</h2>
        {opportunities.length === 0 ? (
          <p className="muted">Sin pendientes detectados para hoy. Buen trabajo.</p>
        ) : (
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
        )}
      </div>
    </section>
  );
}
