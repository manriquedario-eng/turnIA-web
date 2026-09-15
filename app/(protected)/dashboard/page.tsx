import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';

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

  const displayName = profileResult.data?.display_name || user.email || 'profesional';

  const opportunities: string[] = [];
  if (cancelledAppointments.length > 0) {
    opportunities.push(`${cancelledAppointments.length} turno${cancelledAppointments.length === 1 ? '' : 's'} cancelado${cancelledAppointments.length === 1 ? '' : 's'} hoy: podés ofrecer ese horario a alguien en lista de espera.`);
  }
  if (pendingToday > 0) {
    opportunities.push(`Tenés $${pendingToday.toLocaleString('es-AR')} pendiente de cobro por los turnos de hoy.`);
  }
  if (waitlist.length > 0) {
    opportunities.push(`${waitlist.length} paciente${waitlist.length === 1 ? '' : 's'} esperando disponibilidad.`);
  }
  if (appointments.length === 0) {
    opportunities.push('No tenés turnos cargados para hoy. Podés crear uno o revisar la lista de espera.');
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
          <Link className="btn secondary" href="/patients">Nuevo paciente</Link>
          <Link className="btn secondary" href="/payments">Registrar cobro</Link>
          <Link className="btn secondary" href={`/agenda?view=day&date=${today}`}>Ver agenda</Link>
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
                const cardClass = ['appointment-card', isNext ? 'is-next' : '', cancelled ? 'is-cancelled' : ''].filter(Boolean).join(' ');
                return (
                  <div key={appointment.id} className={cardClass}>
                    <div className="appointment-main">
                      <div className="appointment-time">{formatTime(appointment.starts_at)}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{appointment.patients?.name ?? 'Sin paciente'}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {appointment.services?.name ?? 'Sin servicio'} · {appointment.modality}
                        </div>
                      </div>
                      {isNext ? <span className="badge badge-confirmado">Próximo</span> : null}
                    </div>
                    <div className="appointment-meta">
                      <span className="muted" style={{ fontSize: 13 }}>
                        {appointment.quoted_amount != null ? `${appointment.currency ?? 'ARS'} ${Number(appointment.quoted_amount).toLocaleString('es-AR')}` : '—'}
                      </span>
                      <StatusBadge status={appointment.status} />
                      {!cancelled ? (
                        <Link href={`/agenda?view=day&date=${today}&edit=${appointment.id}`} className="btn secondary" style={{ padding: '7px 12px', fontSize: 13 }}>
                          Editar
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Próximo paciente</h2>
            {nextAppointment ? (
              <div className="stack" style={{ gap: 4 }}>
                <strong style={{ fontSize: 20 }}>{formatTime(nextAppointment.starts_at)}</strong>
                <div style={{ fontWeight: 600 }}>{(nextAppointment as any).patients?.name ?? 'Sin paciente'}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {(nextAppointment as any).services?.name ?? 'Sin servicio'} · {nextAppointment.modality}
                </div>
                <StatusBadge status={nextAppointment.status} />
              </div>
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
                  <div key={entry.id} style={{ paddingBottom: 8, borderBottom: '1px solid var(--color-border-soft)' }}>
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
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Pendientes y oportunidades</h2>
        {opportunities.length === 0 ? (
          <p className="muted">Sin pendientes detectados para hoy. Buen trabajo.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {opportunities.map((text) => (
              <li key={text} style={{ marginBottom: 6 }}>{text}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
