// Resolución + AUTORIZACIÓN server-side de todo lo que se puede exportar
// (PARTE 2 del pedido de exportación: "NO generar una exportación usando
// solamente un id recibido desde el cliente sin volver a validar
// server-side").
//
// Reglas que se repiten en cada función acá:
//   - siempre se recibe `tenantId` desde `requireTenant()` (nunca desde un
//     parámetro de la URL/formulario);
//   - todo `.eq('tenant_id', tenantId)` explícito, además de la RLS de cada
//     tabla — misma defensa en profundidad que ya usa el resto de la app
//     (ver agenda/actions.ts, reminders/actions.ts);
//   - un paciente se resuelve primero con `.eq('id', patientId).eq('tenant_id',
//     tenantId)`: si no matchea (porque no existe o es de OTRO tenant), la
//     función devuelve `null` y el caller responde 404 — nunca se sigue
//     construyendo el export con datos parciales de un id ajeno;
//   - las mismas reglas de negocio que ya rigen las pantallas (cancelado no
//     cuenta para "próximo turno", etc. — ver agenda/page.tsx,
//     patients/page.tsx, patients/[id]/page.tsx) se reutilizan tal cual, para
//     que lo exportado sea consistente con lo que la persona ve en pantalla.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityRow,
  AgendaExportData,
  AgendaExportRow,
  CashMovementExportRow,
  FollowUpRow,
  PatientExportData,
  PatientPaymentRow,
  PatientsListExportData,
  PatientsListRow,
  PaymentExportRow,
  PaymentsExportData,
  ProfessionalInfo,
  SessionRow,
} from './types';

const TZ = 'America/Argentina/Buenos_Aires';

function isCancelled(status: string | null | undefined) {
  return status === 'cancelled' || status === 'cancelado';
}

function dateKeyInTz(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export async function getProfessionalInfo(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  fallbackEmail: string | null,
): Promise<ProfessionalInfo> {
  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    supabase.from('settings').select('profile').eq('tenant_id', tenantId).maybeSingle(),
  ]);

  const raw = settings?.profile && typeof settings.profile === 'object' ? (settings.profile as Record<string, unknown>) : {};
  const field = (key: string) => (typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : null);

  return {
    displayName: profile?.display_name || fallbackEmail || 'Profesional de TurnIA',
    profession: field('profession'),
    licenseNumber: field('license_number'),
    professionalCollege: field('professional_college'),
    cuit: field('cuit'),
    businessName: field('business_name'),
    officeAddress: field('office_address'),
    locality: field('locality'),
    province: field('province'),
    professionalPhone: field('professional_phone'),
    professionalEmail: field('professional_email'),
  };
}

/**
 * Ficha completa de un paciente para exportar. Devuelve `null` si el
 * paciente no existe, está archivado, o no pertenece a este tenant — en
 * cualquiera de esos casos el caller (ruta API) responde 404 sin más
 * detalle (mismo criterio de no distinguir el motivo que ya usa
 * lib/appointments/public-token.ts).
 */
export async function fetchPatientExportData(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  patientId: string,
  fallbackEmail: string | null,
): Promise<PatientExportData | null> {
  const [patientResult, followUpResult, appointmentResult, paymentResult, recordResult, professional] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,phone,email,dni,insurance_name,insurance_member_number,insurance_plan,care_location,default_price')
      .eq('id', patientId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('patient_follow_ups')
      .select('id,content,source_type,created_at,appointment_id')
      .eq('patient_id', patientId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('appointments')
      .select('id,starts_at,status,modality,quoted_amount,currency,services(name)')
      .eq('patient_id', patientId)
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('payments')
      .select('id,appointment_id,amount,currency,method,created_at')
      .eq('patient_id', patientId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('patient_records')
      .select('id,reason,follow_up,background,diagnosis,notes,plan,updated_at')
      .eq('patient_id', patientId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    getProfessionalInfo(supabase, userId, tenantId, fallbackEmail),
  ]);

  const patient = patientResult.data;
  if (!patient) return null; // No existe, archivado, o de otro tenant: mismo resultado hacia afuera.

  const appointments = (appointmentResult.data ?? []) as any[];
  const followUps = (followUpResult.data ?? []) as any[];
  const payments = (paymentResult.data ?? []) as any[];
  const record = recordResult.data;

  const appointmentById = new Map(appointments.map((a) => [a.id, a]));
  function isSessionRow(f: any): boolean {
    if (f.source_type === 'manual_session') return true;
    if (f.source_type === 'manual_follow_up') return false;
    return Boolean(f.appointment_id);
  }
  const sessionNotes = followUps.filter(isSessionRow);
  const generalFollowUps = followUps.filter((f) => !isSessionRow(f));

  const now = Date.now();
  const activeAppointments = appointments.filter((a) => !isCancelled(a.status));
  const nextAppointment = activeAppointments
    .filter((a) => new Date(a.starts_at).getTime() >= now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
  const lastAppointment = activeAppointments
    .filter((a) => new Date(a.starts_at).getTime() < now)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0];

  const paidByAppointment = new Map<string, number>();
  for (const payment of payments) {
    if (!payment.appointment_id) continue;
    paidByAppointment.set(payment.appointment_id, (paidByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0));
  }
  const pendingBalance = activeAppointments.reduce((sum, a) => {
    const quoted = Number(a.quoted_amount ?? 0);
    const paid = paidByAppointment.get(a.id) ?? 0;
    return sum + Math.max(quoted - paid, 0);
  }, 0);

  // Sesiones: fecha real del turno si existe (no la fecha en que se escribió
  // la nota), igual que ya hace patients/[id]/page.tsx.
  const sessions: SessionRow[] = sessionNotes.map((item) => {
    const appt = item.appointment_id ? appointmentById.get(item.appointment_id) : undefined;
    return {
      date: appt?.starts_at ?? item.created_at,
      service: appt?.services?.name ?? null,
      modality: appt?.modality ?? null,
      status: appt?.status ?? null,
      note: item.content ?? null,
    };
  });

  const followUpRows: FollowUpRow[] = generalFollowUps.map((item) => ({
    date: item.created_at,
    content: item.content ?? '',
  }));

  const activity: ActivityRow[] = [
    ...appointments.map((item) => ({
      date: item.starts_at,
      type: 'Turno',
      title: `${item.services?.name ?? 'Servicio'} — ${item.status ?? 'sin estado'}`,
      detail: item.quoted_amount != null ? `${item.currency ?? 'ARS'} ${item.quoted_amount}` : null,
    })),
    ...payments.map((item) => ({
      date: item.created_at,
      type: 'Pago',
      title: `${item.currency ?? 'ARS'} ${item.amount}`,
      detail: item.method ?? null,
    })),
    ...followUps.map((item) => ({
      date: item.created_at,
      type: isSessionRow(item) ? 'Sesión' : 'Seguimiento',
      title: isSessionRow(item) ? 'Nota de sesión' : 'Seguimiento',
      detail: item.content ?? null,
    })),
    ...(record
      ? [{
          date: record.updated_at,
          type: 'Ficha',
          title: 'Ficha del paciente actualizada',
          detail: record.reason || record.diagnosis || record.follow_up || record.notes || record.plan || null,
        }]
      : []),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const patientPayments: PatientPaymentRow[] = payments.map((item) => ({
    date: item.created_at,
    amount: Number(item.amount ?? 0),
    currency: item.currency ?? 'ARS',
    method: item.method ?? null,
    appointmentDate: item.appointment_id ? appointmentById.get(item.appointment_id)?.starts_at ?? null : null,
  }));

  return {
    professional,
    patient: {
      name: patient.name,
      dni: patient.dni,
      phone: patient.phone,
      email: patient.email,
      insuranceName: patient.insurance_name,
      insuranceMemberNumber: patient.insurance_member_number,
      insurancePlan: patient.insurance_plan,
      careLocation: patient.care_location,
      defaultPrice: patient.default_price != null ? Number(patient.default_price) : null,
    },
    summary: {
      nextAppointmentAt: nextAppointment?.starts_at ?? null,
      nextAppointmentStatus: nextAppointment?.status ?? null,
      lastAppointmentAt: lastAppointment?.starts_at ?? null,
      lastAppointmentStatus: lastAppointment?.status ?? null,
      pendingBalance,
    },
    clinicalRecord: record
      ? {
          reason: record.reason,
          background: record.background,
          diagnosis: record.diagnosis,
          followUp: record.follow_up,
          notes: record.notes,
          plan: record.plan,
          updatedAt: record.updated_at,
        }
      : null,
    sessions,
    followUps: followUpRows,
    activity,
    payments: patientPayments,
    generatedAt: new Date().toISOString(),
  };
}

/** Listado de pacientes del tenant actual — nunca información clínica (PARTE 8). */
export async function fetchPatientsListExportData(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  fallbackEmail: string | null,
): Promise<PatientsListExportData> {
  const [{ data: patients }, professional] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,phone,email,dni,insurance_name,insurance_plan,default_price')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name'),
    getProfessionalInfo(supabase, userId, tenantId, fallbackEmail),
  ]);

  const patientIds = (patients ?? []).map((p) => p.id);
  const appointmentsResult = patientIds.length
    ? await supabase
        .from('appointments')
        .select('id, patient_id, starts_at, status, quoted_amount')
        .eq('tenant_id', tenantId)
        .in('patient_id', patientIds)
    : { data: [] as any[] };

  const paymentsResult = patientIds.length
    ? await supabase
        .from('payments')
        .select('patient_id, appointment_id, amount')
        .eq('tenant_id', tenantId)
        .in('patient_id', patientIds)
    : { data: [] as any[] };

  const now = Date.now();
  const nextByPatient = new Map<string, { starts_at: string; status: string | null }>();
  const balanceByAppointment = new Map<string, number>();
  for (const payment of paymentsResult.data ?? []) {
    if (!payment.appointment_id) continue;
    balanceByAppointment.set(payment.appointment_id, (balanceByAppointment.get(payment.appointment_id) ?? 0) + Number(payment.amount ?? 0));
  }
  const pendingByPatient = new Map<string, number>();
  for (const appt of appointmentsResult.data ?? []) {
    if (isCancelled(appt.status) || !appt.patient_id) continue;
    if (new Date(appt.starts_at).getTime() >= now && !nextByPatient.has(appt.patient_id)) {
      nextByPatient.set(appt.patient_id, appt);
    }
    const quoted = Number(appt.quoted_amount ?? 0);
    const paid = balanceByAppointment.get(appt.id) ?? 0;
    const pending = Math.max(quoted - paid, 0);
    pendingByPatient.set(appt.patient_id, (pendingByPatient.get(appt.patient_id) ?? 0) + pending);
  }

  const rows: PatientsListRow[] = (patients ?? []).map((p) => ({
    name: p.name,
    phone: p.phone,
    email: p.email,
    dni: p.dni,
    insuranceName: p.insurance_name,
    insurancePlan: p.insurance_plan,
    status: 'Activo',
    nextAppointmentAt: nextByPatient.get(p.id)?.starts_at ?? null,
    pendingBalance: pendingByPatient.get(p.id) ?? 0,
  }));

  return { professional, rows, generatedAt: new Date().toISOString() };
}

const PAYMENTS_EXPORT_PAGE_SIZE = 1000;
const PAYMENTS_EXPORT_MAX_ROWS = 10_000;

export class PaymentsExportTooLargeError extends Error {
  constructor() {
    super('El período seleccionado contiene demasiados registros para una exportación segura.');
    this.name = 'PaymentsExportTooLargeError';
  }
}

type PaymentsExportRange = {
  fromIso?: string;
  toIso?: string;
};

async function fetchAllPaymentsForExport(
  supabase: SupabaseClient,
  tenantId: string,
  range: PaymentsExportRange,
): Promise<any[]> {
  const rows: any[] = [];

  for (let offset = 0; ; offset += PAYMENTS_EXPORT_PAGE_SIZE) {
    let query = supabase
      .from('payments')
      .select('id, amount, currency, method, created_at, appointment_id, patients(name), appointments(starts_at)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (range.fromIso) query = query.gte('created_at', range.fromIso);
    if (range.toIso) query = query.lte('created_at', range.toIso);

    const { data, error } = await query.range(offset, offset + PAYMENTS_EXPORT_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (rows.length > PAYMENTS_EXPORT_MAX_ROWS) throw new PaymentsExportTooLargeError();
    if (page.length < PAYMENTS_EXPORT_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchAllCashMovementsForExport(
  supabase: SupabaseClient,
  tenantId: string,
  range: PaymentsExportRange,
): Promise<any[]> {
  const rows: any[] = [];

  for (let offset = 0; ; offset += PAYMENTS_EXPORT_PAGE_SIZE) {
    let query = supabase
      .from('cash_movements')
      .select('id, amount, method, kind, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (range.fromIso) query = query.gte('created_at', range.fromIso);
    if (range.toIso) query = query.lte('created_at', range.toIso);

    const { data, error } = await query.range(offset, offset + PAYMENTS_EXPORT_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (rows.length > PAYMENTS_EXPORT_MAX_ROWS) throw new PaymentsExportTooLargeError();
    if (page.length < PAYMENTS_EXPORT_PAGE_SIZE) break;
  }

  return rows;
}

/** Pagos y caja del tenant actual, con período opcional y paginación real. */
export async function fetchPaymentsExportData(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  fallbackEmail: string | null,
  range: PaymentsExportRange = {},
): Promise<PaymentsExportData> {
  const [payments, cashMovements, professional] = await Promise.all([
    fetchAllPaymentsForExport(supabase, tenantId, range),
    fetchAllCashMovementsForExport(supabase, tenantId, range),
    getProfessionalInfo(supabase, userId, tenantId, fallbackEmail),
  ]);

  const paymentRows: PaymentExportRow[] = payments.map((item: any) => ({
    date: item.created_at,
    patientName: item.patients?.name ?? null,
    method: item.method ?? null,
    amount: Number(item.amount ?? 0),
    currency: item.currency ?? 'ARS',
    appointmentDate: item.appointments?.starts_at ?? null,
  }));

  const cashRows: CashMovementExportRow[] = cashMovements.map((item: any) => ({
    date: item.created_at,
    kind: item.kind === 'in' ? 'in' : 'out',
    concept: item.method ?? null,
    amount: Number(item.amount ?? 0),
  }));

  return { professional, payments: paymentRows, cashMovements: cashRows, generatedAt: new Date().toISOString() };
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function mondayIndex(date: string) {
  const value = new Date(`${date}T12:00:00-03:00`);
  return (value.getUTCDay() + 6) % 7;
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00-03:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function startOfDayIso(date: string) {
  return new Date(`${date}T00:00:00-03:00`).toISOString();
}
function endOfDayIso(date: string) {
  return new Date(`${date}T23:59:59-03:00`).toISOString();
}

/**
 * Agenda del tenant actual para un período (PARTE 10). Mismo cálculo de
 * rango que app/(protected)/agenda/page.tsx para Día/Semana/Mes.
 * Deliberadamente NO incluye meeting_url (PARTE 10: "no incluir meeting_url
 * completo en una exportación general si no es necesario").
 */
export async function fetchAgendaExportData(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  fallbackEmail: string | null,
  view: 'day' | 'week' | 'month',
  date: string,
): Promise<AgendaExportData> {
  let rangeStart = date;
  let rangeEnd = date;
  let periodLabel = date;

  if (view === 'week') {
    const start = addDays(date, -mondayIndex(date));
    rangeStart = start;
    rangeEnd = addDays(start, 6);
    periodLabel = `Semana del ${rangeStart} al ${rangeEnd}`;
  } else if (view === 'month') {
    const monthFirst = `${date.slice(0, 7)}-01`;
    const nextMonthFirst = new Date(`${monthFirst}T12:00:00-03:00`);
    nextMonthFirst.setUTCMonth(nextMonthFirst.getUTCMonth() + 1);
    const monthLast = addDays(nextMonthFirst.toISOString().slice(0, 10), -1);
    rangeStart = addDays(monthFirst, -mondayIndex(monthFirst));
    rangeEnd = addDays(monthLast, 6 - mondayIndex(monthLast));
    periodLabel = date.slice(0, 7);
  } else {
    periodLabel = date;
  }

  const [{ data: appointments }, professional] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, status, modality, patients(name), services(name)')
      .eq('tenant_id', tenantId)
      .gte('starts_at', startOfDayIso(rangeStart))
      .lte('starts_at', endOfDayIso(rangeEnd))
      .order('starts_at', { ascending: true }),
    getProfessionalInfo(supabase, userId, tenantId, fallbackEmail),
  ]);

  const rows: AgendaExportRow[] = (appointments ?? []).map((item: any) => ({
    date: dateKeyInTz(item.starts_at),
    startTime: item.starts_at,
    endTime: item.ends_at,
    patientName: item.patients?.name ?? null,
    service: item.services?.name ?? null,
    modality: item.modality ?? null,
    status: item.status ?? null,
  }));

  return { professional, view, periodLabel, rows, generatedAt: new Date().toISOString() };
}

export { WEEKDAY_LABELS };
