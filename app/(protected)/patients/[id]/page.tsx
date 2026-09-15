import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { archivePatient, createManualFollowUp, updatePatient, upsertPatientRecord } from '../actions';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { IconMail, IconPhone } from '@/components/ui/icons';
import { Tabs } from '@/components/ui/Tabs';
import { statusLabel, modalityLabel, paymentMethodLabel } from '@/lib/labels';

const TZ = 'America/Argentina/Buenos_Aires';

type TimelineItem = {
  id: string;
  at: string;
  type: 'Turno' | 'Pago' | 'Seguimiento' | 'Ficha';
  title: string;
  detail?: string;
};

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

const TIMELINE_TYPE_CLASS: Record<TimelineItem['type'], string> = {
  Turno: 'type-turno',
  Pago: 'type-pago',
  Seguimiento: 'type-seguimiento',
  Ficha: 'type-ficha',
};

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const [patientResult, followUpResult, appointmentResult, paymentResult, recordResult] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,phone,email,dni,insurance_name,insurance_member_number,insurance_plan,care_location,default_price,created_at,phone_e164,whatsapp_consent,whatsapp_consent_at,appointment_reminders_opt_in')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('patient_follow_ups')
      .select('id,content,source_type,created_at,professional_id,appointment_id')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('appointments')
      .select('id,starts_at,status,modality,quoted_amount,currency,services(name)')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('payments')
      .select('id,appointment_id,amount,currency,method,created_at')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('patient_records')
      .select('id,reason,follow_up,background,notes,plan,updated_at')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  const patient = patientResult.data;
  const followUps = followUpResult.data ?? [];
  const appointments = appointmentResult.data ?? [];
  const payments = paymentResult.data ?? [];
  const record = recordResult.data;

  if (!patient) notFound();

  // Sesiones vs. Seguimientos: misma tabla (patient_follow_ups). Se separan
  // usando `source_type` + `appointment_id` juntos (no sólo presentación):
  // - source_type = 'manual_session' o 'manual_follow_up' (valores nuevos) →
  //   se respeta tal cual.
  // - registros viejos (source_type = 'manual_text' u otro valor no
  //   reconocido) → se clasifican por appointment_id, igual que antes, para
  //   no perder ni reclasificar mal datos históricos.
  // Ver el comentario en actions.ts → createManualFollowUp.
  const appointmentById = new Map(appointments.map((a: any) => [a.id, a]));
  function isSessionRow(f: any): boolean {
    if (f.source_type === 'manual_session') return true;
    if (f.source_type === 'manual_follow_up') return false;
    return Boolean(f.appointment_id);
  }
  const sessionNotes = followUps.filter(isSessionRow);
  const generalFollowUps = followUps.filter((f: any) => !isSessionRow(f));

  const timeline: TimelineItem[] = [
    ...appointments.map((item: any) => ({
      id: `appointment-${item.id}`,
      at: item.starts_at,
      type: 'Turno' as const,
      title: `${item.services?.name ?? 'Servicio'} · ${statusLabel(item.status)}`,
      detail: `${modalityLabel(item.modality)}${item.quoted_amount != null ? ` · ${item.currency} ${item.quoted_amount}` : ''}`,
    })),
    ...payments.map((item: any) => ({
      id: `payment-${item.id}`,
      at: item.created_at,
      type: 'Pago' as const,
      title: `${item.currency} ${item.amount}`,
      detail: paymentMethodLabel(item.method),
    })),
    ...followUps.map((item: any) => ({
      id: `followup-${item.id}`,
      at: item.created_at,
      type: 'Seguimiento' as const,
      title: item.appointment_id ? 'Nota de sesión' : 'Seguimiento',
      detail: item.content,
    })),
    ...(record ? [{
      id: `record-${record.id}`,
      at: record.updated_at,
      type: 'Ficha' as const,
      title: 'Ficha del paciente actualizada',
      detail: record.reason || record.follow_up || record.notes || record.plan || undefined,
    }] : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // Cálculos de presentación sobre datos ya obtenidos — sin queries nuevas.
  const now = Date.now();
  const activeAppointments = appointments.filter((a: any) => !isCancelled(a.status));
  const nextAppointment = activeAppointments
    .filter((a: any) => new Date(a.starts_at).getTime() >= now)
    .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
  const lastAppointment = activeAppointments
    .filter((a: any) => new Date(a.starts_at).getTime() < now)
    .sort((a: any, b: any) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0];

  const paidByAppointment = new Map<string, number>();
  for (const payment of payments as any[]) {
    if (!payment.appointment_id) continue;
    paidByAppointment.set(payment.appointment_id, (paidByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0));
  }
  const balance = activeAppointments.reduce((sum: number, a: any) => {
    const quoted = Number(a.quoted_amount ?? 0);
    const paid = paidByAppointment.get(a.id) ?? 0;
    return sum + Math.max(quoted - paid, 0);
  }, 0);

  const initials = patient.name.trim().slice(0, 2).toUpperCase();
  const todayForNewAppointment = nextAppointment
    ? undefined
    : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

  return (
    <section className="stack">
      <p><Link href="/patients">← Volver a pacientes</Link></p>

      {query.error ? <p className="alert error">{query.error}</p> : null}
      {query.success === 'updated' ? <p className="alert success">Datos actualizados.</p> : null}
      {query.success === 'followup' ? <p className="alert success">Nota guardada.</p> : null}
      {query.success === 'record' ? <p className="alert success">Ficha clínica actualizada.</p> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 16px' }}>
          <div className="patient-header">
            <div className="patient-header-identity">
              <div className="patient-avatar-lg">{initials}</div>
              <div>
                <h1 style={{ marginBottom: 4 }}>{patient.name}</h1>
                <div className="patient-contact-list">
                  {patient.phone ? <span><IconPhone size={14} /> {patient.phone}</span> : null}
                  {patient.email ? <span><IconMail size={14} /> {patient.email}</span> : null}
                  {!patient.phone && !patient.email ? <span>Sin datos de contacto cargados</span> : null}
                </div>
              </div>
            </div>

            <div className="nav" style={{ flexWrap: 'wrap' }}>
              <Link
                className="btn"
                href={`/agenda?view=day&date=${todayForNewAppointment ?? ''}&new=1&patient=${patient.id}#turno-drawer`}
              >
                Nuevo turno
              </Link>
              <Link className="btn secondary" href="/payments">Registrar pago</Link>
            </div>
          </div>
        </div>

        <div className="stat-strip" style={{ border: 'none', borderRadius: 0, borderTop: '1px solid var(--color-border-soft)', boxShadow: 'none' }}>
          <div className="stat-strip-item">
            <span className="stat-strip-label">Próximo turno</span>
            {nextAppointment ? (
              <span className="nav" style={{ gap: 8 }}>
                <span className="stat-strip-value" style={{ fontSize: 16 }}>{formatDateTime(nextAppointment.starts_at)}</span>
                <StatusBadge status={nextAppointment.status} label={statusLabel(nextAppointment.status)} />
              </span>
            ) : (
              <span className="stat-strip-hint">Sin turnos programados</span>
            )}
          </div>
          <div className="stat-strip-item">
            <span className="stat-strip-label">Último turno</span>
            {lastAppointment ? (
              <span className="nav" style={{ gap: 8 }}>
                <span className="stat-strip-value" style={{ fontSize: 16 }}>{formatDateTime(lastAppointment.starts_at)}</span>
                <StatusBadge status={lastAppointment.status} label={statusLabel(lastAppointment.status)} />
              </span>
            ) : (
              <span className="stat-strip-hint">Sin turnos anteriores</span>
            )}
          </div>
          <div className="stat-strip-item">
            <span className="stat-strip-label">Saldo pendiente</span>
            <span className="stat-strip-value">${balance.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'clinica', label: 'Ficha clínica' },
          { id: 'sesiones', label: 'Sesiones' },
          { id: 'actividad', label: 'Actividad' },
          { id: 'seguimientos', label: 'Seguimientos' },
          { id: 'datos', label: 'Datos' },
        ]}
      >
        <div data-tab="clinica">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Ficha clínica</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Información clínica general del paciente. Se edita directamente acá.
            </p>
            {!record ? (
              <p className="muted" style={{ fontSize: 13 }}>Todavía no hay información clínica registrada.</p>
            ) : null}
            <form action={upsertPatientRecord} className="stack">
              <input type="hidden" name="patientId" value={patient.id} />
              <label>
                Motivo de consulta
                <textarea name="reason" defaultValue={record?.reason ?? ''} rows={2} maxLength={10000} style={{ width: '100%' }} />
              </label>
              <label>
                Antecedentes
                <textarea name="background" defaultValue={record?.background ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
              </label>
              <label>
                Plan / indicaciones
                <textarea name="plan" defaultValue={record?.plan ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
              </label>
              <label>
                Notas generales
                <textarea name="notes" defaultValue={record?.notes ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
              </label>
              <div>
                <button className="btn" type="submit">{record ? 'Guardar cambios' : 'Completar ficha clínica'}</button>
              </div>
            </form>
          </div>
        </div>

        <div data-tab="sesiones">
          <div className="stack">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Registrar nota de sesión</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Asociada a un turno concreto: evolución, indicaciones y próximos pasos de esa atención.
              </p>
              <form action={createManualFollowUp} className="stack">
                <input type="hidden" name="patientId" value={patient.id} />
                <label>
                  Turno
                  <select name="appointmentId" required defaultValue="">
                    <option value="" disabled>Seleccionar turno</option>
                    {appointments.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {formatDateTime(a.starts_at)} · {a.services?.name ?? 'Servicio'} · {statusLabel(a.status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Notas de la sesión
                  <textarea name="content" required minLength={2} maxLength={10000} rows={5} style={{ width: '100%' }} />
                </label>
                <div>
                  <button className="btn" type="submit">Guardar sesión</button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Historial de sesiones</h2>
              {sessionNotes.length === 0 ? (
                <EmptyState title="Todavía no hay sesiones registradas" description="Se completan desde el formulario de arriba, asociadas a un turno." />
              ) : (
                <div>
                  {sessionNotes.map((item: any) => {
                    const appt = appointmentById.get(item.appointment_id);
                    return (
                      <div key={item.id} className="timeline-item">
                        <div className="timeline-marker type-turno" />
                        <div className="timeline-body">
                          <small className="muted">
                            {appt ? formatDateTime(appt.starts_at) : formatDateTime(item.created_at)}
                            {appt?.services?.name ? ` · ${appt.services.name}` : ''}
                          </small>
                          <p style={{ whiteSpace: 'pre-wrap', marginTop: 2, marginBottom: 0 }}>{item.content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div data-tab="actividad">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Timeline del paciente</h2>
            <p className="muted">Turnos, pagos, seguimientos y actualización de ficha en una sola línea de tiempo.</p>
            {timeline.length === 0 ? (
              <EmptyState title="Todavía no hay actividad registrada" />
            ) : (
              <div>
                {timeline.map((item) => (
                  <div key={item.id} className="timeline-item">
                    <div className={`timeline-marker ${TIMELINE_TYPE_CLASS[item.type]}`} />
                    <div className="timeline-body">
                      <small className="muted">{formatDateTime(item.at)} · {item.type}</small>
                      <p style={{ marginBottom: item.detail ? 4 : 0, marginTop: 2 }}><strong>{item.title}</strong></p>
                      {item.detail ? <p style={{ whiteSpace: 'pre-wrap', marginTop: 0, fontSize: 14 }}>{item.detail}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div data-tab="seguimientos">
          <div className="stack">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Nuevo seguimiento</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Notas posteriores, controles, tareas o recordatorios que no están atados a un turno puntual.
              </p>
              <form action={createManualFollowUp} className="stack">
                <input type="hidden" name="patientId" value={patient.id} />
                <label>
                  Nota de seguimiento
                  <textarea name="content" required minLength={2} maxLength={10000} rows={5} style={{ width: '100%' }} />
                </label>
                <div>
                  <button className="btn" type="submit">Guardar seguimiento</button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Historial de seguimientos</h2>
              {generalFollowUps.length === 0 ? (
                <EmptyState title="Todavía no hay seguimientos" />
              ) : (
                <div>
                  {generalFollowUps.map((item: any) => (
                    <div key={item.id} className="timeline-item">
                      <div className="timeline-marker type-seguimiento" />
                      <div className="timeline-body">
                        <small className="muted">{formatDateTime(item.created_at)}</small>
                        <p style={{ whiteSpace: 'pre-wrap', marginTop: 2, marginBottom: 0 }}>{item.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div data-tab="datos">
          <div className="stack">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Datos del paciente</h2>
              <form action={updatePatient} className="form-grid">
                <input type="hidden" name="id" value={patient.id} />
                <label>Nombre<input name="name" defaultValue={patient.name} required minLength={2} maxLength={160} /></label>
                <PhoneInput defaultValue={patient.phone ?? ''} />
                <label>Email<input name="email" type="email" defaultValue={patient.email ?? ''} maxLength={200} /></label>
                <label>DNI<input name="dni" defaultValue={patient.dni ?? ''} maxLength={160} /></label>
                <label>Obra social<input name="insurance_name" defaultValue={patient.insurance_name ?? ''} maxLength={160} /></label>
                <label>Nº afiliado<input name="insurance_member_number" defaultValue={patient.insurance_member_number ?? ''} maxLength={160} /></label>
                <label>Plan<input name="insurance_plan" defaultValue={patient.insurance_plan ?? ''} maxLength={160} /></label>
                <label>Lugar de atención<input name="care_location" defaultValue={patient.care_location ?? ''} maxLength={160} /></label>
                <label>Precio habitual<input name="default_price" type="number" min="0" step="0.01" defaultValue={patient.default_price ?? ''} /></label>

                <div style={{ gridColumn: '1 / -1' }}>
                  <h3 style={{ margin: '4px 0' }}>Comunicación y recordatorios</h3>
                  <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                    Sin autorización explícita, no se enviará ningún mensaje automático en el futuro.
                    {(patient as any).whatsapp_consent_at
                      ? ` Autorización registrada el ${formatDateTime((patient as any).whatsapp_consent_at)}.`
                      : ''}
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      name="whatsapp_consent"
                      style={{ width: 'auto' }}
                      defaultChecked={Boolean((patient as any).whatsapp_consent)}
                    />
                    Autoriza recibir mensajes por WhatsApp
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      name="appointment_reminders_opt_in"
                      style={{ width: 'auto' }}
                      defaultChecked={Boolean((patient as any).appointment_reminders_opt_in)}
                    />
                    Recibir recordatorios automáticos de turnos
                  </label>
                </div>

                <div className="form-actions">
                  <button className="btn" type="submit">Guardar cambios</button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Archivar paciente</h2>
              <p className="muted">No elimina físicamente los datos. Marca el paciente como archivado.</p>
              <form action={archivePatient}>
                <input type="hidden" name="id" value={patient.id} />
                <button className="btn danger" type="submit">Archivar</button>
              </form>
            </div>
          </div>
        </div>
      </Tabs>
    </section>
  );
}
