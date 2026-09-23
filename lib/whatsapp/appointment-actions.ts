import {
  cancelAppointmentByToken,
  confirmAppointmentByToken,
  requestRescheduleByToken,
} from '@/lib/appointments/public-token';
import { sendTransactionalEmail, isPlausibleEmail } from '@/lib/email/provider';
import { normalizePhone } from '@/lib/phone';
import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';
import { sendWhatsAppTemplate } from './provider';

export type AppointmentWhatsAppAction = 'confirm' | 'cancel' | 'reschedule';

export type ProcessWhatsAppAppointmentActionInput = {
  providerMessageId: string;
  fromWaId: string;
  contextMessageId?: string | null;
  token: string;
  action: AppointmentWhatsAppAction;
};

export type ProcessWhatsAppAppointmentActionResult = {
  ok: boolean;
  shouldReply: boolean;
  replyText?: string;
  appointmentId?: string;
  duplicate?: boolean;
};

const SUCCESS_TEXT: Record<AppointmentWhatsAppAction, string> = {
  confirm: 'Perfecto, tu turno quedó confirmado.',
  cancel: 'Tu turno fue cancelado correctamente.',
  reschedule:
    'Perfecto, ya le avisamos al profesional. Se va a contactar con vos para coordinar la reprogramación de tu turno.',
};

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

async function registerProfessionalAlert(params: {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  channel: 'email' | 'whatsapp';
  payload: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from('appointment_messages')
    .insert({
      tenant_id: params.tenantId,
      patient_id: params.patientId,
      appointment_id: params.appointmentId,
      message_type: 'professional_reschedule_requested',
      channel: params.channel,
      status: 'pending',
      payload: params.payload,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    // Unique violation means this semantic notification was already created.
    if (error?.code === '23505') return null;
    return null;
  }
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
      provider_message_id: params.providerMessageId ?? null,
      error_message: params.ok ? null : params.errorMessage?.slice(0, 500) ?? 'No se pudo enviar el aviso.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.messageRowId);
}

async function notifyProfessionalAboutReschedule(params: {
  tenantId: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  startsAt: string;
}) {
  const supabase = createSupabaseServiceClient();
  const { data: settings } = await supabase
    .from('settings')
    .select('profile')
    .eq('tenant_id', params.tenantId)
    .maybeSingle();

  const profile =
    settings?.profile && typeof settings.profile === 'object'
      ? (settings.profile as Record<string, unknown>)
      : {};

  const professionalEmail =
    typeof profile.professional_email === 'string' ? profile.professional_email.trim() : '';
  const professionalPhone =
    typeof profile.professional_phone === 'string' ? profile.professional_phone.trim() : '';

  const dateLabel = formatDate(params.startsAt);
  const timeLabel = formatTime(params.startsAt);
  const subject = `Solicitud de reprogramación — ${params.patientName} — ${dateLabel}`;
  const text = [
    'TurnIA',
    '',
    `${params.patientName} solicitó reprogramar su turno.`,
    `Fecha actual: ${dateLabel}`,
    `Hora actual: ${timeLabel}`,
    '',
    'El turno no fue movido ni cancelado. Ingresá a TurnIA para coordinar un nuevo horario con el paciente.',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111827;">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">TurnIA</p>
      <h1 style="font-size:20px;">Solicitud de reprogramación</h1>
      <p><strong>${params.patientName.replace(/[<>&"']/g, '')}</strong> solicitó reprogramar su turno.</p>
      <p>Fecha actual: <strong>${dateLabel}</strong><br/>Hora actual: <strong>${timeLabel}</strong></p>
      <p>El turno no fue movido ni cancelado. Ingresá a TurnIA para coordinar un nuevo horario con el paciente.</p>
    </div>
  `.trim();

  if (professionalEmail && isPlausibleEmail(professionalEmail)) {
    const messageRowId = await registerProfessionalAlert({
      appointmentId: params.appointmentId,
      tenantId: params.tenantId,
      patientId: params.patientId,
      channel: 'email',
      payload: { recipient: 'professional', patientName: params.patientName, dateLabel, timeLabel },
    });

    if (messageRowId) {
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

  // A WhatsApp message to the professional is business-initiated and must use
  // its own approved Utility template. Until that template name is configured,
  // this branch deliberately skips the phone alert instead of sending free text.
  const professionalTemplateName = process.env.WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_NAME;
  const professionalTemplateLang =
    process.env.WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_LANG ||
    process.env.WHATSAPP_TEMPLATE_LANG ||
    'es_AR';

  if (professionalPhone && professionalTemplateName) {
    const normalized = normalizePhone(professionalPhone);
    if (normalized.isValid && normalized.e164) {
      const messageRowId = await registerProfessionalAlert({
        appointmentId: params.appointmentId,
        tenantId: params.tenantId,
        patientId: params.patientId,
        channel: 'whatsapp',
        payload: { recipient: 'professional', patientName: params.patientName, dateLabel, timeLabel },
      });

      if (messageRowId) {
        const result = await sendWhatsAppTemplate({
          toE164: normalized.e164,
          bodyParams: [params.patientName, dateLabel, timeLabel],
          templateName: professionalTemplateName,
          templateLang: professionalTemplateLang,
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

export async function processWhatsAppAppointmentAction(
  input: ProcessWhatsAppAppointmentActionInput,
): Promise<ProcessWhatsAppAppointmentActionResult> {
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      shouldReply: false,
    };
  }

  const supabase = createSupabaseServiceClient();

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, tenant_id, patient_id, starts_at')
    .eq('public_token', input.token)
    .maybeSingle();

  if (!appointment?.id || !appointment.tenant_id || !appointment.patient_id) {
    return {
      ok: false,
      shouldReply: true,
      replyText: 'Este turno ya no está disponible.',
    };
  }

  const { data: patient } = await supabase
    .from('patients')
    .select('name, phone_e164')
    .eq('id', appointment.patient_id)
    .eq('tenant_id', appointment.tenant_id)
    .maybeSingle();

  const senderDigits = digits(input.fromWaId);
  const patientDigits = digits(patient?.phone_e164);

  // A button received from another WhatsApp number is never allowed to mutate
  // the appointment, even if the payload/token is otherwise valid.
  if (!senderDigits || !patientDigits || senderDigits !== patientDigits) {
    await supabase.from('whatsapp_inbound_events').insert({
      provider_message_id: input.providerMessageId,
      tenant_id: appointment.tenant_id,
      appointment_id: appointment.id,
      patient_id: appointment.patient_id,
      action: input.action,
      status: 'rejected',
      sender_wa_id: input.fromWaId,
      error_message: 'sender_mismatch',
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).then(() => undefined, () => undefined);

    return { ok: false, shouldReply: false };
  }

  // When Meta provides the replied-to message id, bind the action to an actual
  // WhatsApp message TurnIA sent for this same appointment.
  if (input.contextMessageId) {
    const { data: contextMessage } = await supabase
      .from('appointment_messages')
      .select('id')
      .eq('appointment_id', appointment.id)
      .eq('channel', 'whatsapp')
      .eq('provider_message_id', input.contextMessageId)
      .maybeSingle();

    if (!contextMessage) {
      return { ok: false, shouldReply: false };
    }
  }

  const { error: eventInsertError } = await supabase
    .from('whatsapp_inbound_events')
    .insert({
      provider_message_id: input.providerMessageId,
      tenant_id: appointment.tenant_id,
      appointment_id: appointment.id,
      patient_id: appointment.patient_id,
      action: input.action,
      status: 'processing',
      sender_wa_id: input.fromWaId,
    });

  if (eventInsertError?.code === '23505') {
    // Meta retried the same webhook. The first delivery owns the action and
    // response; this retry must not create duplicate side effects.
    return { ok: true, shouldReply: false, appointmentId: appointment.id, duplicate: true };
  }

  if (eventInsertError) {
    return { ok: false, shouldReply: false };
  }

  const mutation =
    input.action === 'confirm'
      ? await confirmAppointmentByToken(input.token)
      : input.action === 'cancel'
        ? await cancelAppointmentByToken(input.token)
        : await requestRescheduleByToken(input.token, 'Solicitud recibida por WhatsApp');

  if (!mutation.ok) {
    await supabase
      .from('whatsapp_inbound_events')
      .update({
        status: 'failed',
        error_message: mutation.error.slice(0, 500),
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('provider_message_id', input.providerMessageId);

    return {
      ok: false,
      shouldReply: true,
      replyText: mutation.error,
      appointmentId: appointment.id,
    };
  }

  await supabase
    .from('whatsapp_inbound_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('provider_message_id', input.providerMessageId);

  // Store the patient's semantic response on the exact outgoing message when
  // Meta supplied context; otherwise fall back to the latest WhatsApp row.
  let outboundMessageId: string | null = null;
  if (input.contextMessageId) {
    const { data } = await supabase
      .from('appointment_messages')
      .select('id')
      .eq('appointment_id', appointment.id)
      .eq('channel', 'whatsapp')
      .eq('provider_message_id', input.contextMessageId)
      .maybeSingle();
    outboundMessageId = data?.id ?? null;
  } else {
    const { data } = await supabase
      .from('appointment_messages')
      .select('id')
      .eq('appointment_id', appointment.id)
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    outboundMessageId = data?.id ?? null;
  }

  if (outboundMessageId) {
    await supabase
      .from('appointment_messages')
      .update({
        patient_response: input.action,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', outboundMessageId);
  }

  if (input.action === 'reschedule') {
    await notifyProfessionalAboutReschedule({
      tenantId: appointment.tenant_id,
      appointmentId: appointment.id,
      patientId: appointment.patient_id,
      patientName: patient?.name || 'Paciente',
      startsAt: appointment.starts_at,
    });
  }

  return {
    ok: true,
    shouldReply: true,
    replyText: SUCCESS_TEXT[input.action],
    appointmentId: appointment.id,
  };
}
