import { isPlausibleEmail, sendTransactionalEmail } from '@/lib/email/provider';
import { resolvePatientCommunicationName } from '@/lib/patients/communication-name';
import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';

const TZ = 'America/Argentina/Buenos_Aires';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

async function createProfessionalConfirmationRow(params: {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceClient();

  const { data: existing } = await supabase
    .from('appointment_messages')
    .select('id,status')
    .eq('appointment_id', params.appointmentId)
    .eq('message_type', 'professional_appointment_confirmed')
    .eq('channel', 'email')
    .eq('dedupe_key', params.dedupeKey)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'failed') {
      const { data: claimedRetry, error: retryError } = await supabase
        .from('appointment_messages')
        .update({
          status: 'pending',
          error_message: null,
          provider_message_id: null,
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle();

      if (retryError) return null;
      if (claimedRetry?.id) return claimedRetry.id as string;
    }

    return null;
  }

  const { data, error } = await supabase
    .from('appointment_messages')
    .insert({
      tenant_id: params.tenantId,
      patient_id: params.patientId,
      appointment_id: params.appointmentId,
      message_type: 'professional_appointment_confirmed',
      channel: 'email',
      dedupe_key: params.dedupeKey,
      status: 'pending',
      payload: params.payload,
    })
    .select('id')
    .maybeSingle();

  if (error?.code === '23505' || error || !data) return null;
  return data.id as string;
}

async function finishProfessionalConfirmation(params: {
  messageRowId: string;
  ok: boolean;
  providerMessageId?: string;
  errorMessage?: string;
}) {
  const supabase = createSupabaseServiceClient();

  await supabase
    .from('appointment_messages')
    .update({
      status: params.ok ? 'sent' : 'failed',
      sent_at: params.ok ? new Date().toISOString() : null,
      delivered_at: params.ok ? null : undefined,
      read_at: params.ok ? null : undefined,
      failed_at: params.ok ? null : new Date().toISOString(),
      provider_message_id: params.providerMessageId ?? null,
      error_message: params.ok
        ? null
        : params.errorMessage?.slice(0, 500) ?? 'No se pudo enviar el aviso de confirmación.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.messageRowId);
}

export async function notifyProfessionalAboutConfirmationByToken(token: string): Promise<void> {
  if (!isServiceRoleConfigured()) return;

  const supabase = createSupabaseServiceClient();

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id,tenant_id,patient_id,professional_id,starts_at,status')
    .eq('public_token', token)
    .maybeSingle();

  if (
    !appointment?.id ||
    !appointment.tenant_id ||
    !appointment.patient_id ||
    !appointment.professional_id ||
    !['confirmed', 'confirmado'].includes(String(appointment.status ?? '').toLowerCase())
  ) {
    return;
  }

  const [{ data: patient }, { data: professionalContact }] = await Promise.all([
    supabase
      .from('patients')
      .select('name,alias,use_alias_for_communications')
      .eq('id', appointment.patient_id)
      .eq('tenant_id', appointment.tenant_id)
      .maybeSingle(),
    supabase
      .from('professional_contacts')
      .select('email')
      .eq('tenant_id', appointment.tenant_id)
      .eq('user_id', appointment.professional_id)
      .maybeSingle(),
  ]);

  const professionalEmail =
    typeof professionalContact?.email === 'string'
      ? professionalContact.email.trim()
      : '';

  if (!professionalEmail || !isPlausibleEmail(professionalEmail)) return;

  const patientName = patient
    ? resolvePatientCommunicationName(patient)
    : 'Paciente';
  const dateLabel = formatDate(appointment.starts_at);
  const timeLabel = formatTime(appointment.starts_at);
  const dedupeKey = `professional_appointment_confirmed:${appointment.starts_at}`;
  const agendaUrl = 'https://www.turniahealth.com.ar/agenda';

  const messageRowId = await createProfessionalConfirmationRow({
    appointmentId: appointment.id,
    tenantId: appointment.tenant_id,
    patientId: appointment.patient_id,
    dedupeKey,
    payload: {
      recipient: 'professional',
      patientName,
      dateLabel,
      timeLabel,
    },
  });

  if (!messageRowId) return;

  const safePatientName = patientName.replace(/[<>&"']/g, '');
  const subject = `Turno confirmado — ${patientName} — ${dateLabel}`;
  const text = [
    'TurnIA',
    '',
    `${patientName} confirmó su turno.`,
    `Fecha: ${dateLabel}`,
    `Hora: ${timeLabel}`,
    '',
    'Podés verlo actualizado en la Agenda de TurnIA.',
    agendaUrl,
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111827;">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">TurnIA</p>
      <h1 style="font-size:20px;">Turno confirmado</h1>
      <p><strong>${safePatientName}</strong> confirmó su turno.</p>
      <p>Fecha: <strong>${dateLabel}</strong><br/>Hora: <strong>${timeLabel}</strong></p>
      <p style="margin-top:20px;">
        <a href="${agendaUrl}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">
          Abrir Agenda en TurnIA
        </a>
      </p>
    </div>
  `.trim();

  try {
    const result = await sendTransactionalEmail({
      to: professionalEmail,
      subject,
      html,
      text,
    });

    await finishProfessionalConfirmation({
      messageRowId,
      ok: result.ok,
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      errorMessage: result.ok ? undefined : result.errorMessage,
    });
  } catch {
    await finishProfessionalConfirmation({
      messageRowId,
      ok: false,
      errorMessage: 'Error inesperado al enviar el aviso de confirmación por email.',
    });

    console.error('Professional confirmation email failed', {
      appointmentId: appointment.id,
    });
  }
}
