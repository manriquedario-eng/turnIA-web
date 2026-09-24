import { sendTransactionalEmail, isPlausibleEmail } from '@/lib/email/provider';
import { resolvePatientCommunicationName } from '@/lib/patients/communication-name';
import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/provider';

const TZ = 'America/Argentina/Buenos_Aires';
const TURNIA_URL = 'https://www.turniahealth.com.ar';
const REMINDER_PAGE_SIZE = 200;

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

function isCancelled(status: string | null): boolean {
  return status === 'cancelled' || status === 'cancelado';
}

async function createMessageRow(params: {
  tenantId: string;
  patientId: string;
  appointmentId: string;
  channel: 'email' | 'whatsapp';
  dedupeKey: string;
  payload: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceClient();

  const { data: existing } = await supabase
    .from('appointment_messages')
    .select('id,status')
    .eq('appointment_id', params.appointmentId)
    .eq('message_type', 'appointment_reminder_24h')
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

      if (retryError) return { id: null as string | null, duplicate: false };
      if (claimedRetry?.id) return { id: claimedRetry.id as string, duplicate: false };
    }

    return { id: null as string | null, duplicate: true };
  }

  const { data, error } = await supabase
    .from('appointment_messages')
    .insert({
      tenant_id: params.tenantId,
      patient_id: params.patientId,
      appointment_id: params.appointmentId,
      message_type: 'appointment_reminder_24h',
      channel: params.channel,
      dedupe_key: params.dedupeKey,
      status: 'pending',
      payload: params.payload,
    })
    .select('id')
    .maybeSingle();

  if (error?.code === '23505') return { id: null as string | null, duplicate: true };
  if (error || !data) return { id: null as string | null, duplicate: false };

  return { id: data.id as string, duplicate: false };
}

async function finishMessage(params: {
  id: string;
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
      error_message: params.ok ? null : params.errorMessage?.slice(0, 500) ?? 'No se pudo enviar el recordatorio.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);
}

async function sendReminderEmail(params: {
  tenantId: string;
  patientId: string;
  appointmentId: string;
  patientEmail: string | null;
  patientName: string;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
  startsAt: string;
  publicToken: string;
}) {
  if (!params.patientEmail || !isPlausibleEmail(params.patientEmail)) return;

  const row = await createMessageRow({
    tenantId: params.tenantId,
    patientId: params.patientId,
    appointmentId: params.appointmentId,
    channel: 'email',
    dedupeKey: `appointment_reminder_24h:${params.startsAt}`,
    payload: {
      patientName: params.patientName,
      professionalName: params.professionalName,
      dateLabel: params.dateLabel,
      timeLabel: params.timeLabel,
    },
  });
  if (!row.id) return;

  const base = `${TURNIA_URL}/t/${params.publicToken}`;
  const subject = `Recordatorio de turno — ${params.dateLabel} ${params.timeLabel}`;
  const text = [
    `Hola ${params.patientName},`,
    '',
    'Te recordamos que mañana tenés un turno.',
    `Fecha: ${params.dateLabel}`,
    `Hora: ${params.timeLabel}`,
    `Profesional: ${params.professionalName}`,
    '',
    `Confirmar, cancelar o solicitar reprogramación: ${base}`,
    '',
    'Este es un mensaje automático de TurnIA.',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111827;">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">TurnIA</p>
      <h1 style="font-size:20px;">Recordatorio de turno</h1>
      <p>Hola ${params.patientName.replace(/[<>&"']/g, '')}, mañana tenés un turno.</p>
      <p><strong>Fecha:</strong> ${params.dateLabel}<br/>
         <strong>Hora:</strong> ${params.timeLabel}<br/>
         <strong>Profesional:</strong> ${params.professionalName.replace(/[<>&"']/g, '')}</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;">
        <tr>
          <td style="padding:4px;"><a href="${base}" style="display:block;text-align:center;background:#111827;color:#fff;padding:12px 8px;border-radius:8px;text-decoration:none;font-weight:600;">Confirmar</a></td>
          <td style="padding:4px;"><a href="${base}?action=cancel" style="display:block;text-align:center;background:#f3f4f6;color:#b91c1c;padding:12px 8px;border-radius:8px;text-decoration:none;font-weight:600;">Cancelar</a></td>
          <td style="padding:4px;"><a href="${base}?action=reschedule" style="display:block;text-align:center;background:#f3f4f6;color:#111827;padding:12px 8px;border-radius:8px;text-decoration:none;font-weight:600;">Reprogramar</a></td>
        </tr>
      </table>
      <p style="font-size:12px;color:#9ca3af;">Este es un mensaje automático de TurnIA.</p>
    </div>
  `.trim();

  try {
    const result = await sendTransactionalEmail({
      to: params.patientEmail,
      subject,
      html,
      text,
    });

    await finishMessage({
      id: row.id,
      ok: result.ok,
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      errorMessage: result.ok ? undefined : result.errorMessage,
    });
  } catch (error) {
    await finishMessage({
      id: row.id,
      ok: false,
      errorMessage: 'Error inesperado al enviar el recordatorio por email.',
    });
    throw error;
  }
}

async function sendReminderWhatsApp(params: {
  tenantId: string;
  patientId: string;
  appointmentId: string;
  phoneE164: string | null;
  whatsappConsent: boolean;
  patientName: string;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
  startsAt: string;
  publicToken: string;
}) {
  if (!params.phoneE164 || !params.whatsappConsent) return;

  const templateName = process.env.WHATSAPP_REMINDER_TEMPLATE_NAME;
  const templateLang =
    process.env.WHATSAPP_REMINDER_TEMPLATE_LANG ||
    process.env.WHATSAPP_TEMPLATE_LANG ||
    'es_AR';

  if (!templateName) return;

  const row = await createMessageRow({
    tenantId: params.tenantId,
    patientId: params.patientId,
    appointmentId: params.appointmentId,
    channel: 'whatsapp',
    dedupeKey: `appointment_reminder_24h:${params.startsAt}`,
    payload: {
      patientName: params.patientName,
      professionalName: params.professionalName,
      dateLabel: params.dateLabel,
      timeLabel: params.timeLabel,
      recipientE164: params.phoneE164,
    },
  });
  if (!row.id) return;

  try {
    const result = await sendWhatsAppTemplate({
      toE164: params.phoneE164,
      bodyParams: [
        params.patientName,
        params.dateLabel,
        params.timeLabel,
        params.professionalName,
      ],
      quickReplyPayloads: [
        `turnia:appointment:${params.publicToken}:confirm`,
        `turnia:appointment:${params.publicToken}:cancel`,
        `turnia:appointment:${params.publicToken}:reschedule`,
      ],
      templateName,
      templateLang,
    });

    await finishMessage({
      id: row.id,
      ok: result.ok,
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      errorMessage: result.ok ? undefined : result.errorMessage,
    });
  } catch (error) {
    await finishMessage({
      id: row.id,
      ok: false,
      errorMessage: 'Error inesperado al enviar el recordatorio por WhatsApp.',
    });
    throw error;
  }
}

export async function processAppointmentReminders24h(now = new Date(), tenantId?: string) {
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, reason: 'service_role_not_configured' };
  }

  const supabase = createSupabaseServiceClient();

  // Cron runs every 15 minutes. A ±15 minute window around 24h protects
  // against normal scheduler jitter; per-channel idempotency prevents duplicates.
  const startsFrom = new Date(now.getTime() + (23 * 60 + 45) * 60 * 1000).toISOString();
  const startsTo = new Date(now.getTime() + (24 * 60 + 15) * 60 * 1000).toISOString();

  let scanned = 0;
  let eligible = 0;
  let processed = 0;
  let errors = 0;
  let pages = 0;
  let from = 0;

  while (true) {
    let appointmentsQuery = supabase
      .from('appointments')
      .select('id,tenant_id,patient_id,professional_id,starts_at,status,public_token')
      .gte('starts_at', startsFrom)
      .lte('starts_at', startsTo);

    if (tenantId) {
      appointmentsQuery = appointmentsQuery.eq('tenant_id', tenantId);
    }

    const { data: appointments, error } = await appointmentsQuery
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + REMINDER_PAGE_SIZE - 1);

    if (error) {
      return { ok: false as const, reason: 'appointments_query_failed' };
    }

    const page = appointments ?? [];
    pages += 1;
    scanned += page.length;

    for (const appointment of page) {
      try {
        if (
          !appointment.patient_id ||
          !appointment.public_token ||
          isCancelled(appointment.status) ||
          appointment.status === 'completed' ||
          appointment.status === 'completado'
        ) {
          continue;
        }

        const [{ data: patient }, { data: professional }] = await Promise.all([
          supabase
            .from('patients')
            .select('name,alias,use_alias_for_communications,email,phone_e164,whatsapp_consent,appointment_reminders_opt_in')
            .eq('id', appointment.patient_id)
            .eq('tenant_id', appointment.tenant_id)
            .maybeSingle(),
          appointment.professional_id
            ? supabase
                .from('profiles')
                .select('display_name')
                .eq('id', appointment.professional_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        if (!patient || !patient.appointment_reminders_opt_in) continue;

        eligible += 1;

        const patientName = resolvePatientCommunicationName(patient);
        const professionalName = professional?.display_name || 'tu profesional';
        const dateLabel = formatDate(appointment.starts_at);
        const timeLabel = formatTime(appointment.starts_at);

        const channelResults = await Promise.allSettled([
          sendReminderEmail({
            tenantId: appointment.tenant_id,
            patientId: appointment.patient_id,
            appointmentId: appointment.id,
            patientEmail: patient.email ?? null,
            patientName,
            professionalName,
            dateLabel,
            timeLabel,
            startsAt: appointment.starts_at,
            publicToken: appointment.public_token,
          }),
          sendReminderWhatsApp({
            tenantId: appointment.tenant_id,
            patientId: appointment.patient_id,
            appointmentId: appointment.id,
            phoneE164: patient.phone_e164 ?? null,
            whatsappConsent: Boolean(patient.whatsapp_consent),
            patientName,
            professionalName,
            dateLabel,
            timeLabel,
            startsAt: appointment.starts_at,
            publicToken: appointment.public_token,
          }),
        ]);

        const rejectedChannels = channelResults.filter(
          (result) => result.status === 'rejected',
        ).length;

        if (rejectedChannels > 0) {
          errors += 1;
          console.error('Appointment reminder channel failed', {
            appointmentId: appointment.id,
            rejectedChannels,
          });
        }

        processed += 1;
      } catch {
        errors += 1;
        console.error('Appointment reminder processing failed', {
          appointmentId: appointment.id,
        });
      }
    }

    if (page.length < REMINDER_PAGE_SIZE) break;
    from += REMINDER_PAGE_SIZE;
  }

  return {
    ok: true as const,
    scanned,
    eligible,
    processed,
    errors,
    pages,
    window: { startsFrom, startsTo },
  };
}
