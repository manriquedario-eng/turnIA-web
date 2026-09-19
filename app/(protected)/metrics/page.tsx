import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs } from '@/components/ui/Tabs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TZ = 'America/Argentina/Buenos_Aires';
const CANCELLED = new Set(['cancelled', 'cancelado']);
const NO_SHOW = new Set(['no_show', 'no-show', 'ausente']);

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return [`${hours} h`, minutes ? `${minutes} min` : '', remainder ? `${remainder} s` : '']
      .filter(Boolean)
      .join(' ');
  }
  if (minutes > 0) return remainder ? `${minutes} min ${remainder} s` : `${minutes} min`;
  return `${remainder} s`;
}

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value ?? '';
  return { year: part('year'), month: part('month'), day: part('day') };
}

export default async function MetricsPage() {
  const { supabase, tenantId } = await requireTenant();

  const local = localDateParts(new Date());
  const monthStart = `${local.year}-${local.month}-01T00:00:00-03:00`;
  const todayStart = `${local.year}-${local.month}-${local.day}T00:00:00-03:00`;

  const [
    appointmentsResult,
    paymentsResult,
    transcriptionAccountResult,
    transcriptionUsageResult,
    sessionUsageResult,
    followUpUsageResult,
  ] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, patient_id, starts_at, status, quoted_amount, currency, patients(name)')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('payments')
      .select('appointment_id, amount')
      .eq('tenant_id', tenantId),
    supabase
      .from('ai_transcription_accounts')
      .select('enabled,balance_seconds,lifetime_used_seconds')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('ai_transcription_ledger')
      .select('seconds,usage_context,created_at,patient_id,patients(name)')
      .eq('tenant_id', tenantId)
      .eq('kind', 'usage')
      .gte('created_at', monthStart)
      .order('created_at', { ascending: false }),
    supabase
      .from('ai_transcription_ledger')
      .select('seconds,created_at')
      .eq('tenant_id', tenantId)
      .eq('kind', 'usage')
      .eq('usage_context', 'session')
      .gte('created_at', monthStart),
    supabase
      .from('ai_transcription_ledger')
      .select('seconds,created_at')
      .eq('tenant_id', tenantId)
      .eq('kind', 'usage')
      .eq('usage_context', 'follow_up')
      .gte('created_at', monthStart),
  ]);

  const appointments = appointmentsResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const transcriptionAccount = transcriptionAccountResult.data;
  const transcriptionUsage = transcriptionUsageResult.data ?? [];

  const paidByAppointment = new Map<string, number>();
  for (const payment of payments) {
    paidByAppointment.set(
      payment.appointment_id,
      (paidByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0),
    );
  }

  const collectible = appointments.filter((a) => !CANCELLED.has(a.status ?? ''));
  const debts = collectible
    .map((appointment) => {
      const quoted = Number(appointment.quoted_amount ?? 0);
      const paid = paidByAppointment.get(appointment.id) ?? 0;
      return { ...appointment, quoted, paid, balance: Math.max(quoted - paid, 0) };
    })
    .filter((row) => row.balance > 0);

  const totalQuoted = collectible.reduce((sum, row) => sum + Number(row.quoted_amount ?? 0), 0);
  const totalPaid = payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const totalDebt = debts.reduce((sum, row) => sum + row.balance, 0);
  const noShows = appointments.filter((row) => NO_SHOW.has(row.status ?? '')).length;
  const cancelled = appointments.filter((row) => CANCELLED.has(row.status ?? '')).length;
  const attendanceBase = Math.max(appointments.length - cancelled, 0);
  const noShowRate = attendanceBase > 0 ? (noShows / attendanceBase) * 100 : 0;
  const collectionRate = totalQuoted > 0 ? Math.min((totalPaid / totalQuoted) * 100, 100) : 0;

  const transcriptionBalanceSeconds = Number(transcriptionAccount?.balance_seconds ?? 0);
  const transcriptionMonthSeconds = transcriptionUsage.reduce(
    (sum, row) => sum + Number(row.seconds ?? 0),
    0,
  );
  const transcriptionTodaySeconds = transcriptionUsage
    .filter((row) => new Date(row.created_at).getTime() >= new Date(todayStart).getTime())
    .reduce((sum, row) => sum + Number(row.seconds ?? 0), 0);

  const sessionTranscriptions = sessionUsageResult.data ?? [];
  const followUpTranscriptions = followUpUsageResult.data ?? [];
  const sessionSeconds = sessionTranscriptions.reduce((sum, row) => sum + Number(row.seconds ?? 0), 0);
  const followUpSeconds = followUpTranscriptions.reduce((sum, row) => sum + Number(row.seconds ?? 0), 0);
  const unclassifiedSeconds = Math.max(
    transcriptionMonthSeconds - sessionSeconds - followUpSeconds,
    0,
  );
  const unclassifiedCount = Math.max(
    transcriptionUsage.length - sessionTranscriptions.length - followUpTranscriptions.length,
    0,
  );

  const patientUsage = new Map<string, { name: string; seconds: number; count: number }>();
  for (const row of transcriptionUsage as any[]) {
    const key = row.patient_id ?? 'unassigned';
    const name = row.patients?.name ?? 'Sin paciente asociado';
    const current = patientUsage.get(key) ?? { name, seconds: 0, count: 0 };
    current.seconds += Number(row.seconds ?? 0);
    current.count += 1;
    patientUsage.set(key, current);
  }
  const patientUsageRows = [...patientUsage.entries()]
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.seconds - a.seconds);

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Deudas y métricas</h1>
          <p className="muted">
            Caja, actividad del consultorio y consumo de herramientas, separados para leerlos con claridad.
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'caja', label: 'Caja y cobranzas' },
          { id: 'turnos', label: 'Turnos y pacientes' },
          { id: 'transcripcion', label: 'Transcripción IA' },
        ]}
      >
        <div data-tab="caja" className="stack">
          <div className="metrics-hero-row">
            <div className={`metrics-hero-card ${totalDebt > 0 ? 'has-debt' : ''}`}>
              <span className="patient-meta-label">Pendiente actual</span>
              <span className="metrics-hero-value">${totalDebt.toLocaleString('es-AR')}</span>
              <span className="stat-strip-hint">
                {debts.length} turno{debts.length === 1 ? '' : 's'} con saldo
              </span>
            </div>

            <div className="stat-strip metrics-secondary-strip">
              <div className="stat-strip-item">
                <span className="stat-strip-label">Cobrado registrado</span>
                <span className="stat-strip-value stat-strip-value-money">
                  ${totalPaid.toLocaleString('es-AR')}
                </span>
              </div>
              <div className="stat-strip-item">
                <span className="stat-strip-label">Tasa de cobranza</span>
                <span className="stat-strip-value">{collectionRate.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="nav"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', padding: '20px 20px 0' }}
            >
              <div>
                <h2 style={{ marginTop: 0 }}>Saldos por cobrar</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Turnos no cancelados cuyo importe registrado supera los pagos asociados.
                </p>
              </div>
              <Link className="btn" href="/payments">Registrar cobro</Link>
            </div>

            {debts.length === 0 ? (
              <div style={{ padding: '0 20px 20px' }}>
                <EmptyState
                  title="No hay saldos pendientes"
                  description="Todos los turnos no cancelados están cobrados al día."
                />
              </div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th>Fecha</th>
                      <th style={{ textAlign: 'right' }}>Importe</th>
                      <th style={{ textAlign: 'right' }}>Pagado</th>
                      <th style={{ textAlign: 'right' }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debts.map((row: any) => (
                      <tr key={row.id}>
                        <td>{row.patients?.name ?? 'Sin paciente'}</td>
                        <td className="muted">
                          {new Intl.DateTimeFormat('es-AR', {
                            timeZone: TZ,
                            dateStyle: 'short',
                          }).format(new Date(row.starts_at))}
                        </td>
                        <td className="table-cell-amount muted">${row.quoted.toLocaleString('es-AR')}</td>
                        <td className="table-cell-amount muted">${row.paid.toLocaleString('es-AR')}</td>
                        <td className="table-cell-amount">
                          <strong style={{ color: 'var(--color-warning)' }}>
                            ${row.balance.toLocaleString('es-AR')}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div data-tab="turnos" className="stack">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Actividad de turnos y pacientes</h2>
            <div className="metrics-activity-row">
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{appointments.length}</span>
                <span className="patient-meta-label">Turnos registrados</span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{cancelled}</span>
                <span className="patient-meta-label">Cancelados</span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{noShows}</span>
                <span className="patient-meta-label">Ausencias</span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{noShowRate.toFixed(1)}%</span>
                <span className="patient-meta-label">Tasa de ausentismo</span>
              </div>
            </div>

            {noShows === 0 ? (
              <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
                Actualmente no hay turnos con estado de ausencia registrado.
              </p>
            ) : null}
          </div>
        </div>

        <div data-tab="transcripcion" className="stack">
          <div className="card">
            <div className="page-header" style={{ marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0 }}>Transcripción con IA</h2>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  Consumo actualizado del módulo opcional de dictado.
                </p>
              </div>
              <span className={`badge ${transcriptionAccount?.enabled ? 'badge-confirmado' : 'badge-neutral'}`}>
                {transcriptionAccount?.enabled ? 'Activa' : 'Desactivada'}
              </span>
            </div>

            <div className="metrics-activity-row">
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{formatDuration(transcriptionBalanceSeconds)}</span>
                <span className="patient-meta-label">Saldo disponible</span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{formatDuration(transcriptionTodaySeconds)}</span>
                <span className="patient-meta-label">Usado hoy</span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{formatDuration(transcriptionMonthSeconds)}</span>
                <span className="patient-meta-label">Usado este mes</span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{transcriptionUsage.length}</span>
                <span className="patient-meta-label">Dictados este mes</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Uso por tipo</h2>
            <div className="metrics-activity-row">
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{formatDuration(sessionSeconds)}</span>
                <span className="patient-meta-label">Sesiones</span>
                <span className="stat-strip-hint">
                  {sessionTranscriptions.length} dictado{sessionTranscriptions.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="metrics-activity-item">
                <span className="metrics-activity-value">{formatDuration(followUpSeconds)}</span>
                <span className="patient-meta-label">Seguimientos</span>
                <span className="stat-strip-hint">
                  {followUpTranscriptions.length} dictado{followUpTranscriptions.length === 1 ? '' : 's'}
                </span>
              </div>
              {unclassifiedSeconds > 0 ? (
                <div className="metrics-activity-item">
                  <span className="metrics-activity-value">{formatDuration(unclassifiedSeconds)}</span>
                  <span className="patient-meta-label">Sin clasificar</span>
                  <span className="stat-strip-hint">
                    {unclassifiedCount} dictado{unclassifiedCount === 1 ? '' : 's'} anterior{unclassifiedCount === 1 ? '' : 'es'}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 0' }}>
              <h2 style={{ marginTop: 0 }}>Consumo por paciente · este mes</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Segundos utilizados en notas dictadas para cada paciente.
              </p>
            </div>

            {patientUsageRows.length === 0 ? (
              <div style={{ padding: '0 20px 20px' }}>
                <EmptyState title="Todavía no hay consumo de transcripción este mes" />
              </div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th style={{ textAlign: 'right' }}>Dictados</th>
                      <th style={{ textAlign: 'right' }}>Tiempo consumido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientUsageRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td className="table-cell-amount">{row.count}</td>
                        <td className="table-cell-amount"><strong>{formatDuration(row.seconds)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Tabs>
    </section>
  );
}
