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
import { notifyProfessionalAboutConfirmationByToken } from '@/lib/appointments/confirmation-notifications';
import { getMercadoPagoPaymentOfferByToken } from '@/lib/mercadopago/payment-offer';

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

function successText(
  action: AppointmentWhatsAppAction,
  professionalName: string | null,
  paymentUrl?: string | null,
): string {
  const professionalLabel = professionalName?.trim() || 'el profesional';

  if (action === 'confirm') {
    const base = `Muchas gracias por confirmar tu turno con ${professionalLabel}.`;
    return paymentUrl
      ? `${base}\n\nSi querés abonar tu turno ahora con Mercado Pago, podés hacerlo acá:\n${paymentUrl}`
      : base;
  }

  if (action === 'cancel') {
    return 'Tu turno ha sido cancelado. Para cualquier modificación que necesites, comunicate con el profesional.';
  }

  return 'Ya pusimos en aviso al profesional para que se contacte con vos y puedan reprogramar el turno.';
}

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function buildPublicPaymentUrl(token: string): string | null {
  const previewHost =
    process.env.VERCEL_ENV === 'preview' ? process.env.VERCEL_URL?.trim() : null;
  const baseUrl = previewHost
    ? `https://${previewHost}`
    : process.env.APP_URL?.trim() || 'https://www.turniahealth.com.ar';

  try {
    const url = new URL(`/pagar/${token}`, baseUrl);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
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

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .select('id, tenant_id, patient_id, starts_at, professional_id')
    .eq('public_token', input.token)
    .maybeSingle();

  if (appointmentError) throw appointmentError;

  if (!appointment?.id || !appointment.tenant_id || !appointment.patient_id) {
    return {
      ok: false,
      shouldReply: true,
      replyText: 'Este turno ya no está disponible.',
    };
  }

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('name, phone_e164')
    .eq('id', appointment.patient_id)
    .eq('tenant_id', appointment.tenant_id)
    .maybeSingle();

  if (patientError) throw patientError;

  let professionalName: string | null = null;
  if (appointment.professional_id) {
    const { data: professional, error: professionalError } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', appointment.professional_id)
      .maybeSingle();

    if (professionalError) throw professionalError;
    professionalName =
      typeof professional?.display_name === 'string' && professional.display_name.trim()
        ? professional.display_name.trim()
        : null;
  }

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

  // Quick-reply actions are valid only when Meta identifies the exact
  // outgoing reminder that contained the button. Never fall back to a
  // different/latest message if context is absent or mismatched.
  if (!input.contextMessageId) {
    return { ok: false, shouldReply: false };
  }

  const { data: contextMessage, error: contextError } = await supabase
    .from('appointment_messages')
    .select('id,message_type')
    .eq('appointment_id', appointment.id)
    .eq('channel', 'whatsapp')
    .eq('provider_message_id', input.contextMessageId)
    .maybeSingle();

  if (contextError) throw contextError;

  const allowedContextTypes = new Set(['appointment_reminder_24h']);
  if (!contextMessage || !allowedContextTypes.has(contextMessage.message_type)) {
    return { ok: false, shouldReply: false };
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
    throw eventInsertError;
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

  // Store the patient's semantic response on the exact reminder that
  // supplied the validated quick-reply context.
  const outboundMessageId = contextMessage.id;

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

  if (input.action === 'confirm') {
    try {
      await notifyProfessionalAboutConfirmationByToken(input.token);
    } catch {
      console.error('Professional confirmation notification failed', {
        appointmentId: appointment.id,
      });
    }
  }

  let paymentUrl: string | null = null;
  if (input.action === 'confirm') {
    const offer = await getMercadoPagoPaymentOfferByToken(input.token);
    if (offer.available) {
      paymentUrl = buildPublicPaymentUrl(input.token);
    }
  }

  return {
    ok: true,
    shouldReply: true,
    replyText: successText(input.action, professionalName, paymentUrl),
    appointmentId: appointment.id,
  };
}
