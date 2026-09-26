// Orquesta el envío del email de confirmación al crear un turno. No
// contiene detalles HTTP del proveedor (eso vive en `lib/email/provider.ts`)
// ni lógica de negocio de turnos (eso vive en `agenda/actions.ts`). Mismo
// patrón que `lib/whatsapp/send-appointment-created.ts`.
//
// Contrato con quien lo llama: esta función NUNCA lanza una excepción. Un
// fallo (sin email, email inválido, proveedor no configurado, error del
// proveedor, error de red) se traduce siempre en un registro
// `status = 'failed'` en `appointment_messages` (channel='email') cuando se
// pudo dejar traza, nunca en un throw que pudiera afectar la creación del
// turno que ya se guardó.
//
// PARTE 7 del pedido: hoy no existe ninguna preferencia/consentimiento de
// comunicación por EMAIL en `patients` (sólo hay whatsapp_consent /
// appointment_reminders_opt_in, específicos de WhatsApp). Esta función NO
// inventa un consentimiento legal — envía la confirmación transaccional del
// turno (no marketing) siempre que haya un email con formato válido
// cargado, igual que cualquier sistema de turnos envía su comprobante. Si
// en el futuro se agrega una preferencia explícita de email, hay que leerla
// acá antes del envío (mismo lugar donde WhatsApp chequea whatsappConsent).

import { requireTenant } from '@/lib/auth/require-user';
import { isPlausibleEmail, sendTransactionalEmail } from './provider';
import { getPublicAppUrl } from '@/lib/app-url';

type SupabaseClient = Awaited<ReturnType<typeof requireTenant>>['supabase'];

export type SendAppointmentConfirmationEmailInput = {
  supabase: SupabaseClient;
  tenantId: string;
  patientId: string;
  appointmentId: string;
  patientEmail: string | null;
  patientName: string;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
  modality: 'presencial' | 'domicilio' | 'online';
  meetingUrl: string | null;
  /** Token público del turno (columna `appointments.public_token`), para
      armar los links de Confirmar/Cancelar/Reprogramar. `null` cuando la
      migración que agrega esa columna todavía no corrió — en ese caso el
      email sale igual, simplemente sin esos tres botones. */
  publicToken?: string | null;
  /** checkout_url de Mercado Pago ya generado/reutilizado por
      lib/mercadopago/orders.ts para este turno — SIEMPRE validado ahí
      (isTrustedMercadoPagoCheckoutUrl) antes de llegar acá; esta función
      nunca genera ni valida un checkout, sólo lo muestra si vino. `null` o
      `undefined` cuando Mercado Pago no está conectado, el turno no tiene
      monto, el paciente no tiene email válido, o no se pudo generar el
      checkout — en cualquiera de esos casos el email sale igual, sólo sin
      el bloque de pago (nunca bloquea el envío del resto del email). */
  paymentUrl?: string | null;
};

export type SendAppointmentConfirmationEmailResult =
  | { attempted: false; reason: 'no_email' | 'invalid_email' }
  | { attempted: true; ok: true }
  | { attempted: true; ok: false; reason: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function modalityLabel(modality: SendAppointmentConfirmationEmailInput['modality']): string {
  if (modality === 'online') return 'Online';
  if (modality === 'domicilio') return 'A domicilio';
  return 'Presencial';
}

// Base pública para armar los links de Confirmar/Cancelar/Reprogramar.
// En producción usamos SIEMPRE el dominio canónico propio de TurnIA para
// evitar que emails o callbacks expongan URLs técnicas de vercel.app.
// APP_URL queda disponible para desarrollo/staging explícito.
function publicAppUrl(): string {
  return getPublicAppUrl();
}

/**
 * Compone el asunto/html/texto del email. Deliberadamente minimalista (sin
 * diseñador visual): preparado para branding de TurnIA sin bloquear esta
 * tarea con eso. NUNCA incluye motivo de consulta, diagnóstico ni notas
 * clínicas — sólo los datos operativos del turno (PARTE 6/12 del pedido).
 */
function buildAppointmentConfirmationEmail(input: {
  patientName: string;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
  modality: SendAppointmentConfirmationEmailInput['modality'];
  meetingUrl: string | null;
  publicToken: string | null;
  paymentUrl: string | null;
}) {
  const subject = `Turno con ${input.professionalName} — ${input.dateLabel}`;
  const modalityText = modalityLabel(input.modality);
  const isOnline = input.modality === 'online' && Boolean(input.meetingUrl);

  const lines = [
    `Hola ${input.patientName},`,
    '',
    `Tu turno con ${input.professionalName} quedó agendado.`,
    '',
    `Fecha: ${input.dateLabel}`,
    `Hora: ${input.timeLabel}`,
    `Modalidad: ${modalityText}`,
  ];
  if (isOnline && input.meetingUrl) {
    lines.push('', `Ingresá a la videollamada: ${input.meetingUrl}`);
  }
  lines.push('', 'Este es un mensaje automático de TurnIA.');
  const text = lines.join('\n');

  const meetingBlock = isOnline && input.meetingUrl
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(input.meetingUrl)}" style="background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Unirse a Google Meet</a></p>`
    : '';

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111827;">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:24px;">TurnIA</p>
      <h1 style="font-size:20px;margin:0 0 16px;">Tu turno quedó agendado</h1>
      <p>Hola ${escapeHtml(input.patientName)},</p>
      <p>Tu turno con <strong>${escapeHtml(input.professionalName)}</strong> quedó agendado.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#6b7280;">Fecha</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(input.dateLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Hora</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(input.timeLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Modalidad</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(modalityText)}</td></tr>
      </table>
      ${meetingBlock}
      <p style="font-size:12px;color:#9ca3af;margin-top:32px;">Este es un mensaje automático de TurnIA.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

/**
 * Intenta enviar la confirmación de turno por email, sólo si hay un email
 * con formato válido cargado. Si el turno es online, NUNCA manda un
 * meeting_url vacío: si `meetingUrl` es null, el email sale igual pero sin
 * el bloque de videollamada (evita mandar un link roto/vacío).
 */
export async function sendAppointmentConfirmationEmail(
  input: SendAppointmentConfirmationEmailInput
): Promise<SendAppointmentConfirmationEmailResult> {
  const { supabase, tenantId, patientId, appointmentId, patientEmail } = input;

  if (!patientEmail) return { attempted: false, reason: 'no_email' };
  if (!isPlausibleEmail(patientEmail)) return { attempted: false, reason: 'invalid_email' };

  const { subject, html, text } = buildAppointmentConfirmationEmail({
    patientName: input.patientName,
    professionalName: input.professionalName,
    dateLabel: input.dateLabel,
    timeLabel: input.timeLabel,
    modality: input.modality,
    meetingUrl: input.meetingUrl,
    publicToken: input.publicToken ?? null,
    paymentUrl: input.paymentUrl ?? null,
  });

  try {
    // 1) Registrar el intento ANTES de llamar al proveedor, misma razón que
    // en WhatsApp: trazabilidad incluso si el proceso se interrumpe.
    const { data: messageRow, error: insertError } = await supabase
      .from('appointment_messages')
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        appointment_id: appointmentId,
        message_type: 'appointment_created',
        channel: 'email',
        status: 'pending',
        // Sin contenido médico: sólo los mismos datos operativos del email.
        payload: { patientName: input.patientName, professionalName: input.professionalName, dateLabel: input.dateLabel, timeLabel: input.timeLabel, modality: input.modality },
      })
      .select('id')
      .maybeSingle();

    if (insertError || !messageRow) {
      return { attempted: true, ok: false, reason: 'No se pudo registrar el mensaje saliente.' };
    }

    const result = await sendTransactionalEmail({ to: patientEmail, subject, html, text });

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
    // Red de seguridad final, igual que en WhatsApp: nunca propagar hacia
    // createAppointment.
    const message = err instanceof Error ? err.message : 'Error desconocido al enviar email';
    return { attempted: true, ok: false, reason: message };
  }
}
