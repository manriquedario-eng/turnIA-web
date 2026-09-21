import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { archivePatient, createManualFollowUp, updatePatient, upsertPatientRecord } from '../actions';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { IconMail, IconPhone } from '@/components/ui/icons';
import { Tabs } from '@/components/ui/Tabs';
import { ClinicalRecordCard } from '@/components/patients/ClinicalRecordCard';
import { VoiceTranscriptionTextarea } from '@/components/patients/VoiceTranscriptionTextarea';
import { ExportMenu, type ExportMenuItem } from '@/components/export/ExportMenu';
import { statusLabel, modalityLabel, paymentMethodLabel } from '@/lib/labels';
import { SALE_CONDITIONS, VAT_CONDITIONS } from '@/lib/billing/constants';

const TZ = 'America/Argentina/Buenos_Aires';

type TimelineItem = {
  id: string;
  at: string;
  type: 'Turno' | 'Pago' | 'Seguimiento' | 'Ficha';
  title: string;
  detail?: string;
  /** A dónde navega la fila al hacer click — siempre dentro del paciente
      actual (tab de esta misma página) o, para Turno, al turno concreto en
      Agenda. Nunca se pierde patient_id ni se muestra info de otro
      paciente. */
  href: string;
};

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function safePatientName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || /<[^>]*>/.test(trimmed) || /^(javascript:|data:)/i.test(trimmed)) {
    return 'Paciente';
  }
  return trimmed;
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
      .select('id,name,phone,email,dni,insurance_name,insurance_member_number,insurance_plan,care_location,default_price,created_at,phone_e164,whatsapp_consent,whatsapp_consent_at,appointment_reminders_opt_in,billing_entity_id,fiscal_cuit,fiscal_vat_condition_id,fiscal_address,fiscal_email')
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
      .select('id,reason,follow_up,background,diagnosis,notes,plan,updated_at')
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

  const [{ data: billingEntity }, { data: billingEntities }] = await Promise.all([
    patient.billing_entity_id
      ? supabase
          .from('billing_entities')
          .select('id,display_name,legal_name,cuit,vat_condition_id,commercial_address,billing_email,default_sale_condition')
          .eq('id', patient.billing_entity_id)
          .eq('tenant_id', tenantId)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('billing_entities')
      .select('id,display_name,legal_name,cuit,vat_condition_id,commercial_address,billing_email,default_sale_condition')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('display_name', { ascending: true }),
  ]);

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
      // Turno concreto en Agenda — nunca la agenda general.
      href: `/agenda?view=day&date=${dateKeyInTz(item.starts_at)}&edit=${item.id}#turno-drawer`,
    })),
    ...payments.map((item: any) => ({
      id: `payment-${item.id}`,
      at: item.created_at,
      type: 'Pago' as const,
      title: `${item.currency} ${item.amount}`,
      detail: paymentMethodLabel(item.method),
      // No hay todavía una vista de detalle de un pago individual — se
      // lleva a Pagos y caja, la sección donde se gestionan.
      href: '/payments',
    })),
    ...followUps.map((item: any) => ({
      id: `followup-${item.id}`,
      at: item.created_at,
      type: 'Seguimiento' as const,
      title: item.appointment_id ? 'Nota de sesión' : 'Seguimiento',
      detail: item.content,
      // Nota de sesión → tab Sesiones; seguimiento general → tab
      // Seguimientos. Ambos, del mismo paciente (misma página, sólo cambia
      // el tab vía hash).
      href: item.appointment_id ? '#sesiones' : '#seguimientos',
    })),
    ...(record ? [{
      id: `record-${record.id}`,
      at: record.updated_at,
      type: 'Ficha' as const,
      title: 'Ficha del paciente actualizada',
      detail: record.reason || record.follow_up || record.notes || record.plan || undefined,
      href: '#clinica',
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

  // PARTE 3 del pedido de exportación: acción "Exportar" en el header de la
  // ficha, con las secciones pedidas y los 3 formatos para cada una.
  const exportItems: ExportMenuItem[] = [
    { label: 'Ficha completa', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=full&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=full&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=full&format=xlsx` },
    ] },
    { label: 'Ficha clínica', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=clinical&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=clinical&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=clinical&format=xlsx` },
    ] },
    { label: 'Sesiones', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=sessions&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=sessions&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=sessions&format=xlsx` },
    ] },
    { label: 'Seguimientos', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=followups&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=followups&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=followups&format=xlsx` },
    ] },
    { label: 'Actividad', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=activity&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=activity&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=activity&format=xlsx` },
    ] },
    { label: 'Datos', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=data&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=data&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=data&format=xlsx` },
    ] },
    { label: 'Pagos / estado de cuenta', links: [
      { format: 'pdf', href: `/api/export/patient/${patient.id}?section=payments&format=pdf` },
      { format: 'docx', href: `/api/export/patient/${patient.id}?section=payments&format=docx` },
      { format: 'xlsx', href: `/api/export/patient/${patient.id}?section=payments&format=xlsx` },
    ] },
  ];

  const displayPatientName = safePatientName(patient.name);
  const initials = displayPatientName.slice(0, 2).toUpperCase();
  const firstName = displayPatientName.split(/\s+/)[0] || 'Paciente';
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

      {/* Segunda pasada de rediseño: la ficha del paciente pasa de sentirse
          "tabla administrativa dentro de una card" a una ficha profesional —
          eyebrow + avatar con anillo, acciones con jerarquía primaria/
          secundaria/terciaria clara, y una franja de datos clave propia
          (.patient-meta-bar) en vez de reutilizar el .stat-strip genérico
          que también usan Dashboard/Pagos (mismos datos, sólo cambia la
          presentación — ninguna query ni cálculo nuevo). */}
      <div className="card patient-header-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="patient-header">
          <div className="patient-header-identity">
            <div className="patient-avatar-lg">{initials}</div>
            <div>
              <div className="patient-header-eyebrow">Paciente</div>
              <h1 style={{ margin: '2px 0 4px' }}>{displayPatientName}</h1>
              <div className="patient-contact-list">
                {patient.phone ? <span><IconPhone size={14} /> {patient.phone}</span> : null}
                {patient.email ? <span><IconMail size={14} /> {patient.email}</span> : null}
                {!patient.phone && !patient.email ? <span>Sin datos de contacto cargados</span> : null}
              </div>
            </div>
          </div>

          <div className="patient-header-actions">
            <Link
              className="btn"
              href={`/agenda?view=day&date=${todayForNewAppointment ?? ''}&new=1&patient=${patient.id}#turno-drawer`}
            >
              Nuevo turno
            </Link>
            <Link className="btn secondary" href="/payments">Registrar pago</Link>
            <Link className="btn secondary" href={`/billing/new?patient=${patient.id}`}>Facturar</Link>
            <ExportMenu items={exportItems} />
          </div>
        </div>

        <div className="patient-meta-bar">
          <div className="patient-meta-item">
            <span className="patient-meta-label">Próximo turno</span>
            {nextAppointment ? (
              <span className="patient-meta-value-row">
                <span className="patient-meta-value">{formatDateTime(nextAppointment.starts_at)}</span>
                <StatusBadge status={nextAppointment.status} label={statusLabel(nextAppointment.status)} />
              </span>
            ) : (
              <span className="patient-meta-hint">Sin turnos programados</span>
            )}
          </div>
          <div className="patient-meta-item">
            <span className="patient-meta-label">Último turno</span>
            {lastAppointment ? (
              <span className="patient-meta-value-row">
                <span className="patient-meta-value">{formatDateTime(lastAppointment.starts_at)}</span>
                <StatusBadge status={lastAppointment.status} label={statusLabel(lastAppointment.status)} />
              </span>
            ) : (
              <span className="patient-meta-hint">Sin turnos anteriores</span>
            )}
          </div>
          <div className="patient-meta-item">
            <span className="patient-meta-label">Saldo pendiente</span>
            <span className={`patient-meta-value patient-meta-value-lg ${balance > 0 ? 'is-pending' : ''}`}>
              ${balance.toLocaleString('es-AR')}
            </span>
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
            <h2>Ficha clínica</h2>
            <p className="text-helper" style={{ marginTop: 0 }}>
              Información clínica general del paciente. Se edita directamente acá.
            </p>
            <ClinicalRecordCard
              patientId={patient.id}
              record={record ? { reason: record.reason ?? null, background: record.background ?? null, diagnosis: record.diagnosis ?? null, plan: record.plan ?? null, notes: record.notes ?? null } : null}
              action={upsertPatientRecord}
            />
          </div>
        </div>

        <div data-tab="sesiones">
          <div className="stack">
            <div className="card">
              <h2>Registrar nota de sesión</h2>
              <p className="text-helper" style={{ marginTop: 0 }}>
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
                <VoiceTranscriptionTextarea
                  name="content"
                  label="Notas de la sesión"
                  usageContext="session"
                  patientId={patient.id}
                  required
                  minLength={2}
                  maxLength={10000}
                  rows={5}
                  placeholder="Escribí la evolución o usá “Dictar nota”."
                />
                <div>
                  <button className="btn" type="submit">Guardar sesión</button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2>Sesiones de {firstName}</h2>
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
            <h2>Actividad de {firstName}</h2>
            <p className="muted">Turnos, pagos, seguimientos y actualización de ficha de {firstName} en una sola línea de tiempo.</p>
            {timeline.length === 0 ? (
              <EmptyState title="Todavía no hay actividad registrada" />
            ) : (
              <div>
                {timeline.map((item) => (
                  <Link key={item.id} href={item.href} className="timeline-item timeline-item-link">
                    <div className={`timeline-marker ${TIMELINE_TYPE_CLASS[item.type]}`} />
                    <div className="timeline-body">
                      <small className="muted">{formatDateTime(item.at)} · {item.type}</small>
                      <p style={{ marginBottom: item.detail ? 4 : 0, marginTop: 2 }}><strong>{item.title}</strong></p>
                      {item.detail ? <p style={{ whiteSpace: 'pre-wrap', marginTop: 0, fontSize: 14 }}>{item.detail}</p> : null}
                    </div>
                    <span className="timeline-item-chevron" aria-hidden="true">›</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div data-tab="seguimientos">
          <div className="stack">
            <div className="card">
              <h2>Nuevo seguimiento</h2>
              <p className="text-helper" style={{ marginTop: 0 }}>
                Notas posteriores, controles, tareas o recordatorios que no están atados a un turno puntual.
              </p>
              <form action={createManualFollowUp} className="stack">
                <input type="hidden" name="patientId" value={patient.id} />
                <VoiceTranscriptionTextarea
                  name="content"
                  label="Nota de seguimiento"
                  usageContext="follow_up"
                  patientId={patient.id}
                  required
                  minLength={2}
                  maxLength={10000}
                  rows={5}
                  placeholder="Escribí el seguimiento o usá “Dictar nota”."
                />
                <div>
                  <button className="btn" type="submit">Guardar seguimiento</button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2>Seguimientos de {firstName}</h2>
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
              <h2>Datos del paciente</h2>
              {/* Mismos 3 grupos que "Nuevo paciente" en el listado — nombre
                  de campo y server action intactos, sólo se agrupa. */}
              <form action={updatePatient} className="form-grid">
                <input type="hidden" name="id" value={patient.id} />
                <label>Nombre<input name="name" defaultValue={patient.name} required minLength={2} maxLength={160} /></label>
                <PhoneInput defaultValue={patient.phone ?? ''} defaultE164={patient.phone_e164 ?? null} />
                <label>Email<input name="email" type="email" defaultValue={patient.email ?? ''} maxLength={200} /></label>
                <label>DNI<input name="dni" defaultValue={patient.dni ?? ''} maxLength={160} /></label>
                <label>Lugar de atención<input name="care_location" defaultValue={patient.care_location ?? ''} maxLength={160} /></label>
                <label>Precio habitual<input name="default_price" type="number" min="0" step="0.01" defaultValue={patient.default_price ?? ''} /></label>

                <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
                  <h3>Obra social</h3>
                </div>
                <label>Obra social<input name="insurance_name" defaultValue={patient.insurance_name ?? ''} maxLength={160} /></label>
                <label>Nº afiliado<input name="insurance_member_number" defaultValue={patient.insurance_member_number ?? ''} maxLength={160} /></label>
                <label>Plan<input name="insurance_plan" defaultValue={patient.insurance_plan ?? ''} maxLength={160} /></label>

                <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
                  <h3>Datos fiscales del paciente</h3>
                  <p className="text-helper" style={{ marginTop: 4 }}>
                    Se usan cuando la factura se emite a nombre del paciente para que luego la presente a su obra social por reintegro.
                  </p>
                </div>
                <label>CUIT del paciente<input name="fiscal_cuit" inputMode="numeric" defaultValue={patient.fiscal_cuit ?? ''} placeholder="Opcional · 11 dígitos" maxLength={14} /></label>
                <label>
                  Condición frente al IVA
                  <select name="fiscal_vat_condition_id" defaultValue={patient.fiscal_vat_condition_id ? String(patient.fiscal_vat_condition_id) : '5'}>
                    {VAT_CONDITIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>Domicilio fiscal<input name="fiscal_address" defaultValue={patient.fiscal_address ?? ''} maxLength={240} /></label>
                <label>Email fiscal<input name="fiscal_email" type="email" defaultValue={patient.fiscal_email ?? patient.email ?? ''} maxLength={200} /></label>

                <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
                  <h3>Facturación directa a obra social / empresa</h3>
                  <p className="text-helper" style={{ marginTop: 4 }}>
                    Opcional. Usalo sólo si el profesional factura directamente a una obra social o empresa.
                    Estos datos son del receptor institucional, no del paciente.
                  </p>
                </div>

                <label>
                  Obra social / empresa guardada
                  <select name="billing_entity_id" defaultValue={patient.billing_entity_id ?? ''}>
                    <option value="">Crear / completar una nueva</option>
                    {(billingEntities ?? []).map((entity: any) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.display_name}{entity.cuit ? ` · CUIT ${entity.cuit}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Nombre comercial<input name="billing_display_name" defaultValue={billingEntity?.display_name ?? ''} maxLength={240} /></label>
                <label>Razón social<input name="billing_legal_name" defaultValue={billingEntity?.legal_name ?? ''} maxLength={240} /></label>
                <label>CUIT<input name="billing_cuit" inputMode="numeric" defaultValue={billingEntity?.cuit ?? ''} placeholder="11 dígitos" maxLength={14} /></label>
                <label>
                  Condición frente al IVA
                  <select name="billing_vat_condition_id" defaultValue={billingEntity?.vat_condition_id ? String(billingEntity.vat_condition_id) : ''}>
                    <option value="">Seleccionar...</option>
                    {VAT_CONDITIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>Domicilio comercial / fiscal<input name="billing_address" defaultValue={billingEntity?.commercial_address ?? ''} maxLength={240} /></label>
                <label>Email de facturación<input name="billing_email" type="email" defaultValue={billingEntity?.billing_email ?? ''} maxLength={200} /></label>
                <label>
                  Condición de venta habitual
                  <select name="billing_sale_condition" defaultValue={billingEntity?.default_sale_condition ?? 'cuenta_corriente'}>
                    {SALE_CONDITIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
                  <h3>Comunicación y recordatorios</h3>
                  <p className="text-helper" style={{ marginTop: 4 }}>
                    Sin autorización explícita, no se enviará ningún mensaje automático en el futuro.
                    {(patient as any).whatsapp_consent_at
                      ? ` Autorización registrada el ${formatDateTime((patient as any).whatsapp_consent_at)}.`
                      : ''}
                  </p>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      name="whatsapp_consent"
                      defaultChecked={Boolean((patient as any).whatsapp_consent)}
                    />
                    Autoriza recibir mensajes por WhatsApp
                  </label>
                  <label className="checkbox-field" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      name="appointment_reminders_opt_in"
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

            {/* "Archivar" es destructivo/irreversible en la práctica — antes
                era una card idéntica a "Datos del paciente" (mismo peso
                visual que una acción de guardado normal). Ahora usa un
                acento de borde danger, mismo lenguaje que .metrics-hero-card
                para separar visualmente "zona de riesgo" del resto. */}
            <div className="card danger-zone">
              <h2>Archivar paciente</h2>
              <p className="text-helper">No elimina físicamente los datos. Marca el paciente como archivado.</p>
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
