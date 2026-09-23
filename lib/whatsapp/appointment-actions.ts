import {
  cancelAppointmentByToken,
  confirmAppointmentByToken,
  requestRescheduleByToken,
} from '@/lib/appointments/public-token';
import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';
import { notifyProfessionalAboutRescheduleByToken } from '@/lib/appointments/reschedule-notifications';

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
    await notifyProfessionalAboutRescheduleByToken(input.token);
  }

  return {
    ok: true,
    shouldReply: true,
    replyText: SUCCESS_TEXT[input.action],
    appointmentId: appointment.id,
  };
}
