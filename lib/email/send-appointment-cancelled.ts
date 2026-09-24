import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isPlausibleEmail, sendTransactionalEmail } from './provider';

export type SendAppointmentCancellationEmailInput = {
  supabase: SupabaseClient;
  tenantId: string;
  patientId: string;
  appointmentId: string;
  patientEmail: string | null;
  patientName: string;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
};

export type SendAppointmentCancellationEmailResult =
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

function buildCancellationEmail(input: {
  patientName: string;
  professionalName: string;
  dateLabel: string;
  timeLabel: string;
}) {
  const subject = `Turno cancelado — ${input.dateLabel}`;
  const text = [
    `Hola ${input.patientName},`,
    '',
    `Tu turno con ${input.professionalName} del ${input.dateLabel} a las ${input.timeLabel} fue cancelado.`,
    '',
    'Este es un mensaje automático de TurnIA.',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111827;">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:24px;">TurnIA</p>
      <h1 style="font-size:20px;margin:0 0 16px;">Tu turno fue cancelado</h1>
      <p>Hola ${escapeHtml(input.patientName)},</p>
      <p>
        Tu turno con <strong>${escapeHtml(input.professionalName)}</strong> del
        <strong>${escapeHtml(input.dateLabel)}</strong> a las
        <strong>${escapeHtml(input.timeLabel)}</strong> fue cancelado.
      </p>
      <p style="font-size:12px;color:#9ca3af;margin-top:32px;">Este es un mensaje automático de TurnIA.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

export async function sendAppointmentCancellationEmail(
  input: SendAppointmentCancellationEmailInput,
): Promise<SendAppointmentCancellationEmailResult> {
  if (!input.patientEmail) return { attempted: false, reason: 'no_email' };
  if (!isPlausibleEmail(input.patientEmail)) return { attempted: false, reason: 'invalid_email' };

  const { subject, html, text } = buildCancellationEmail(input);

  try {
    const { data: messageRow, error: insertError } = await input.supabase
      .from('appointment_messages')
      .insert({
        tenant_id: input.tenantId,
        patient_id: input.patientId,
        appointment_id: input.appointmentId,
        message_type: 'appointment_cancelled',
        channel: 'email',
        status: 'pending',
        payload: {
          patientName: input.patientName,
          professionalName: input.professionalName,
          dateLabel: input.dateLabel,
          timeLabel: input.timeLabel,
        },
      })
      .select('id')
      .maybeSingle();

    if (insertError || !messageRow) {
      return { attempted: true, ok: false, reason: 'No se pudo registrar el mensaje de cancelación.' };
    }

    const result = await sendTransactionalEmail({
      to: input.patientEmail,
      subject,
      html,
      text,
    });

    if (result.ok) {
      await input.supabase
        .from('appointment_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: result.providerMessageId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageRow.id)
        .eq('tenant_id', input.tenantId);

      return { attempted: true, ok: true };
    }

    await input.supabase
      .from('appointment_messages')
      .update({
        status: 'failed',
        error_message: result.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageRow.id)
      .eq('tenant_id', input.tenantId);

    return { attempted: true, ok: false, reason: result.errorMessage };
  } catch {
    return { attempted: true, ok: false, reason: 'Error inesperado al enviar la cancelación por email.' };
  }
}
