import { isPlausibleEmail, sendTransactionalEmail } from '@/lib/email/provider';
import { normalizePhone } from '@/lib/phone';
import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/provider';

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

async function createProfessionalAlertRow(params: {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  channel: 'email' | 'whatsapp';
  dedupeKey: string;
  payload: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceClient();

  const { data: existing } = await supabase
    .from('appointment_messages')
    .select('id,status')
    .eq('appointment_id', params.appointmentId)
    .eq('message_type', 'professional_reschedule_requested')
    .eq('channel', params.channel)
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
      message_type: 'professional_reschedule_requested',
      channel: params.channel,
      dedupe_key: params.dedupeKey,
      status: 'pending',
      payload: params.payload,
    })
    .select('id')
    .maybeSingle();

  if (error?.code === '23505' || error || !data) return null;
  return data.id as string;
}

async function finishProfessionalAlert(params: {
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
      error_message: params.ok ? null : params.errorMessage?.slice(0, 500) ?? 'No se pudo enviar el aviso.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.messageRowId);
}

export async function notifyProfessionalAboutRescheduleByToken(token: string): Promise<void> {
  if (!isServiceRoleConfigured()) return;

  const supabase = createSupabaseServiceClient();

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id,tenant_id,patient_id,professional_id,starts_at,reschedule_requested_at')
    .eq('public_token', token)
    .maybeSingle();

  if (!appointment?.id || !appointment.tenant_id || !appointment.patient_id) return;

  const [{ data: patient }, { data: settings }, professionalContactResult] = await Promise.all([
    supabase
      .from('patients')
      .select('name')
      .eq('id', appointment.patient_id)
      .eq('tenant_id', appointment.tenant_id)
      .maybeSingle(),
    supabase
      .from('settings')
      .select('profile')
      .eq('tenant_id', appointment.tenant_id)
      .maybeSingle(),
    appointment.professional_id
      ? supabase
          .from('professional_contacts')
          .select('phone_e164,email')
          .eq('tenant_id', appointment.tenant_id)
          .eq('user_id', appointment.professional_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const patientName = patient?.name || 'Paciente';
  const profile =
    settings?.profile && typeof settings.profile === 'object'
      ? (settings.profile as Record<string, unknown>)
      : {};

  const professionalContact =
    professionalContactResult &&
    'data' in professionalContactResult
      ? professionalContactResult.data
      : null;

  const professionalContactError =
    professionalContactResult &&
    'error' in professionalContactResult
      ? professionalContactResult.error
      : null;

  const professionalContactTableUnavailable =
    professionalContactError?.code === '42P01' ||
    professionalContactError?.code === 'PGRST205';

  // Legacy fallback only while the new per-professional table does not exist.
  // Once the table exists, "no row for this professional" means "no external
  // contact configured" — never send to a tenant-wide contact by guess.
  const professionalEmail =
    typeof professionalContact?.email === 'string'
      ? professionalContact.email.trim()
      : professionalContactTableUnavailable &&
          typeof profile.professional_email === 'string'
        ? profile.professional_email.trim()
        : '';

  const professionalPhone =
    typeof professionalContact?.phone_e164 === 'string'
      ? professionalContact.phone_e164.trim()
      : professionalContactTableUnavailable &&
          typeof profile.professional_phone === 'string'
        ? profile.professional_phone.trim()
        : '';

  const dateLabel = formatDate(appointment.starts_at);
  const timeLabel = formatTime(appointment.starts_at);
  const rescheduleCycle = appointment.reschedule_requested_at ?? appointment.starts_at;
  const dedupeKey = `professional_reschedule_requested:${rescheduleCycle}`;
  const agendaUrl = 'https://www.turniahealth.com.ar/agenda';

  if (professionalEmail && isPlausibleEmail(professionalEmail)) {
    const messageRowId = await createProfessionalAlertRow({
      appointmentId: appointment.id,
      tenantId: appointment.tenant_id,
      patientId: appointment.patient_id,
      channel: 'email',
      dedupeKey,
      payload: { recipient: 'professional', patientName, dateLabel, timeLabel },
    });

    if (messageRowId) {
      const subject = `Solicitud de reprogramación — ${patientName} — ${dateLabel}`;
      const text = [
        'TurnIA',
        '',
        `${patientName} solicitó reprogramar su turno.`,
        `Fecha actual: ${dateLabel}`,
        `Hora actual: ${timeLabel}`,
        '',
        'El turno no fue movido ni cancelado. Ingresá a TurnIA para coordinar un nuevo horario con el paciente.',
        agendaUrl,
      ].join('\n');

      const safePatientName = patientName.replace(/[<>&"']/g, '');
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111827;">
          <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">TurnIA</p>
          <h1 style="font-size:20px;">Solicitud de reprogramación</h1>
          <p><strong>${safePatientName}</strong> solicitó reprogramar su turno.</p>
          <p>Fecha actual: <strong>${dateLabel}</strong><br/>Hora actual: <strong>${timeLabel}</strong></p>
          <p>El turno no fue movido ni cancelado. Ingresá a TurnIA para coordinar un nuevo horario con el paciente.</p>
          <p style="margin-top:20px;">
            <a href="${agendaUrl}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">
              Abrir Agenda en TurnIA
            </a>
          </p>
        </div>
      `.trim();

      const result = await sendTransactionalEmail({
        to: professionalEmail,
        subject,
        html,
        text,
      });

      await finishProfessionalAlert({
        messageRowId,
        ok: result.ok,
        providerMessageId: result.ok ? result.providerMessageId : undefined,
        errorMessage: result.ok ? undefined : result.errorMessage,
      });
    }
  }

  // El WhatsApp al profesional es iniciado por TurnIA, por lo que usa una
  // plantilla Utility propia aprobada por Meta. Sin plantilla configurada,
  // se omite de forma segura sin intentar texto libre.
  const templateName = process.env.WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_NAME;
  const templateLang =
    process.env.WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_LANG ||
    process.env.WHATSAPP_TEMPLATE_LANG ||
    'es_AR';

  if (professionalPhone && templateName) {
    const normalized = normalizePhone(professionalPhone);
    if (normalized.isValid && normalized.e164) {
      const messageRowId = await createProfessionalAlertRow({
        appointmentId: appointment.id,
        tenantId: appointment.tenant_id,
        patientId: appointment.patient_id,
        channel: 'whatsapp',
        dedupeKey,
        payload: { recipient: 'professional', patientName, dateLabel, timeLabel },
      });

      if (messageRowId) {
        const result = await sendWhatsAppTemplate({
          toE164: normalized.e164,
          bodyParams: [patientName, dateLabel, timeLabel],
          templateName,
          templateLang,
        });

        await finishProfessionalAlert({
          messageRowId,
          ok: result.ok,
          providerMessageId: result.ok ? result.providerMessageId : undefined,
          errorMessage: result.ok ? undefined : result.errorMessage,
        });
      }
    }
  }
}
