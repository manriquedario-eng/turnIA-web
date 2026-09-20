// Orquesta el envío del WhatsApp inicial al crear un turno. No contiene
// detalles HTTP de Meta (eso vive en `lib/whatsapp/provider.ts`) ni lógica de
// negocio de turnos (eso vive en `agenda/actions.ts`).
//
// Contrato con quien lo llama: esta función NUNCA lanza una excepción. Un
// fallo de WhatsApp (credenciales ausentes, teléfono inválido, error de Meta,
// error de red) se traduce siempre en un registro `status = 'failed'` en
// `appointment_messages`, nunca en un throw que pudiera hacer fallar la
// creación del turno que ya se guardó.
//
// Alcance de 5E.2: sólo el mensaje inicial `appointment_created`. NO incluye
// recordatorio de 24h, botones interactivos, recepción de respuestas,
// webhooks ni cambios de estado del turno — eso queda para fases futuras.

import { requireTenant } from '@/lib/auth/require-user';
import { sendWhatsAppTemplate } from './provider';

type SupabaseClient = Awaited<ReturnType<typeof requireTenant>>['supabase'];

export type SendAppointmentCreatedInput = {
  supabase: SupabaseClient;
  tenantId: string;
  patientId: string;
  appointmentId: string;
  patientName: string;
  phoneE164: string | null;
  whatsappConsent: boolean;
  appointmentRemindersOptIn: boolean;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
};

export type SendAppointmentCreatedResult =
  | { attempted: false; reason: 'no_phone' | 'no_consent' | 'no_reminders_opt_in' }
  | { attempted: true; ok: true }
  | { attempted: true; ok: false; reason: string };

/**
 * Intenta enviar "Hola {{nombre}}, tenés un turno el {{fecha}} a las {{hora}}
 * con {{profesional}}." por WhatsApp, sólo si se cumplen TODAS las
 * condiciones de consentimiento. Si no se cumplen, no llama a Meta, no
 * inventa consentimiento y no deja registro (no hay nada que registrar: no
 * se intentó ningún envío).
 */
export async function sendAppointmentCreatedMessage(
  input: SendAppointmentCreatedInput
): Promise<SendAppointmentCreatedResult> {
  const {
    supabase,
    tenantId,
    patientId,
    appointmentId,
    patientName,
    phoneE164,
    whatsappConsent,
    appointmentRemindersOptIn,
    professionalName,
    dateLabel,
    timeLabel,
  } = input;

  if (!phoneE164) return { attempted: false, reason: 'no_phone' };
  if (!whatsappConsent) return { attempted: false, reason: 'no_consent' };
  if (!appointmentRemindersOptIn) return { attempted: false, reason: 'no_reminders_opt_in' };

  try {
    // 1) Registrar el intento ANTES de llamar a Meta, para que quede
    // trazabilidad incluso si el proceso se interrumpe durante el envío.
    const { data: messageRow, error: insertError } = await supabase
      .from('appointment_messages')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        appointment_id: appointmentId,
        message_type: 'appointment_created',
        channel: 'whatsapp',
        status: 'pending',
        payload: { patientName, professionalName, dateLabel, timeLabel },
      })
      .select('id')
      .maybeSingle();

    if (insertError || !messageRow) {
      // No se pudo ni siquiera dejar traza. No hay turno en riesgo (ya está
      // creado); simplemente no se intenta el envío.
      return { attempted: true, ok: false, reason: 'No se pudo registrar el mensaje saliente.' };
    }

    // 2) Intentar el envío real (o modo seguro si faltan credenciales).
    const result = await sendWhatsAppTemplate({
      toE164: phoneE164,
      bodyParams: [patientName, dateLabel, timeLabel, professionalName],
    });

    // 3) Reflejar el resultado en el mismo registro.
    if (result.ok) {
      await supabase
        .from('appointment_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: result.providerMessageId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageRow.id)
        .eq('tenant_id', tenantId);

      return { attempted: true, ok: true };
    }

    await supabase
      .from('appointment_messages')
      .update({
        status: 'failed',
        error_message: result.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageRow.id)
      .eq('tenant_id', tenantId);

    return { attempted: true, ok: false, reason: result.errorMessage };
  } catch (err) {
    // Red de seguridad final: cualquier error inesperado acá se traga y se
    // reporta como resultado, nunca se propaga hacia createAppointment.
    const message = err instanceof Error ? err.message : 'Error desconocido al enviar WhatsApp';
    return { attempted: true, ok: false, reason: message };
  }
}
