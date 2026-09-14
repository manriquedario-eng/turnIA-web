'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { sendAppointmentCreatedMessage } from '@/lib/whatsapp/send-appointment-created';
import { createGoogleMeetForAppointment } from '@/lib/google/calendar';
import { sendAppointmentConfirmationEmail } from '@/lib/email/send-appointment-created';

const MESSAGING_TZ = 'America/Argentina/Buenos_Aires';

function formatAppointmentDateLabel(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: MESSAGING_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatAppointmentTimeLabel(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: MESSAGING_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const appointmentSchema = z.object({
  id: z.string().uuid().optional(),
  patient_id: z.string().uuid(),
  service_id: z.string().uuid(),
  starts_at_local: localDateTime,
  ends_at_local: localDateTime,
  modality: z.enum(['presencial', 'domicilio', 'online']),
  quoted_amount: z.coerce.number().nonnegative().optional(),
});

function toMendozaIso(local: string) {
  return new Date(`${local}:00-03:00`).toISOString();
}

async function validateRelations(tenantId: string, patientId: string, serviceId: string) {
  const { supabase } = await requireTenant();
  const [{ data: patient, error: patientError }, { data: service, error: serviceError }] = await Promise.all([
    supabase.from('patients').select('id').eq('id', patientId).eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle(),
    supabase.from('services').select('id, duration_minutes, price, currency').eq('id', serviceId).eq('tenant_id', tenantId).maybeSingle(),
  ]);
  if (patientError || !patient) throw new Error('Paciente inválido para este consultorio.');
  if (serviceError || !service) throw new Error('Servicio inválido para este consultorio.');
  return service;
}

function safeReturn(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/agenda');
  return returnTo.startsWith('/agenda') ? returnTo : '/agenda';
}

function parseAppointment(formData: FormData) {
  return appointmentSchema.safeParse({
    id: formData.get('id') || undefined,
    patient_id: formData.get('patient_id'),
    service_id: formData.get('service_id'),
    starts_at_local: formData.get('starts_at_local'),
    ends_at_local: formData.get('ends_at_local'),
    modality: formData.get('modality'),
    quoted_amount: formData.get('quoted_amount') || undefined,
  });
}

export async function createAppointment(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const parsed = parseAppointment(formData);
  if (!parsed.success) redirect(`${returnTo}&error=Datos%20de%20turno%20inválidos`);

  const startsAt = toMendozaIso(parsed.data.starts_at_local);
  const endsAt = toMendozaIso(parsed.data.ends_at_local);
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (end <= start) redirect(`${returnTo}&error=La%20hora%20de%20fin%20debe%20ser%20posterior`);
  if (start.getTime() < Date.now() - 60_000) redirect(`${returnTo}&error=No%20se%20pueden%20crear%20turnos%20en%20el%20pasado`);

  const service = await validateRelations(tenantId, parsed.data.patient_id, parsed.data.service_id);
  const { data: created, error } = await supabase.from('appointments').insert({
    tenant_id: tenantId,
    patient_id: parsed.data.patient_id,
    service_id: parsed.data.service_id,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: 'America/Argentina/Buenos_Aires',
    modality: parsed.data.modality,
    status: 'scheduled',
    quoted_amount: parsed.data.quoted_amount ?? service.price ?? null,
    currency: service.currency ?? 'ARS',
    professional_id: user.id,
  }).select('id').maybeSingle();

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);

  // El turno ya está creado y confirmado en este punto. Todo lo que sigue
  // (Google Meet, email, WhatsApp) es estrictamente posterior y está
  // aislado: un error en cualquiera de estas integraciones nunca debe
  // revertir ni afectar el turno ya guardado, por eso cada una va en su
  // propio try/catch y ninguna corre antes del insert de arriba. Mismo
  // principio que ya regía para WhatsApp, extendido ahora a Google Meet y
  // email (PARTE 9 del pedido: "un fallo en Google, email o WhatsApp nunca
  // debe impedir crear el turno").
  if (created?.id) {
    let patient: {
      name: string;
      email: string | null;
      phone_e164: string | null;
      whatsapp_consent: boolean | null;
      appointment_reminders_opt_in: boolean | null;
    } | null = null;
    let professionalName = user.email || 'tu profesional';

    try {
      const [{ data: patientRow }, { data: profile }] = await Promise.all([
        supabase
          .from('patients')
          .select('name, email, phone_e164, whatsapp_consent, appointment_reminders_opt_in')
          .eq('id', parsed.data.patient_id)
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
      ]);
      patient = patientRow ?? null;
      professionalName = profile?.display_name || user.email || 'tu profesional';
    } catch {
      // Si ni siquiera se pudo leer al paciente/profesional, no se intenta
      // ninguna integración — pero el turno ya quedó creado igual.
      patient = null;
    }

    const dateLabel = formatAppointmentDateLabel(startsAt);
    const timeLabel = formatAppointmentTimeLabel(startsAt);
    let meetingUrl: string | null = null;

    // 4) Google Meet — sólo para turnos online, y sólo si el profesional
    // tiene Google Calendar conectado. "not_connected" es un estado
    // esperado (la UI de agenda ya avisa al profesional en ese caso) y no
    // se trata como error de diagnóstico; cualquier otro motivo de fallo sí
    // se registra, sin datos sensibles.
    if (patient && parsed.data.modality === 'online') {
      try {
        const meetResult = await createGoogleMeetForAppointment({
          tenantId,
          professionalUserId: user.id,
          appointmentId: created.id,
          summary: `Turno TurnIA: ${patient.name} con ${professionalName}`,
          startsAtIso: startsAt,
          endsAtIso: endsAt,
          timeZone: MESSAGING_TZ,
        });

        if (meetResult.ok) {
          meetingUrl = meetResult.meetUrl;
          await supabase
            .from('appointments')
            .update({
              meeting_provider: 'google_meet',
              meeting_url: meetResult.meetUrl,
              external_calendar_event_id: meetResult.eventId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', created.id)
            .eq('tenant_id', tenantId);
        } else if (meetResult.reason !== 'not_connected') {
          console.error('No se pudo crear Google Meet para el turno', created.id, meetResult.reason);
        }
      } catch (err) {
        console.error('Error inesperado creando Google Meet', created.id, err instanceof Error ? err.message : 'error desconocido');
      }
    }

    // 6) Email de confirmación — aislado, nunca afecta al turno ya creado.
    if (patient) {
      try {
        await sendAppointmentConfirmationEmail({
          supabase,
          tenantId,
          patientId: parsed.data.patient_id,
          appointmentId: created.id,
          patientEmail: patient.email ?? null,
          patientName: patient.name,
          professionalName,
          dateLabel,
          timeLabel,
          modality: parsed.data.modality,
          meetingUrl,
        });
      } catch {
        // sendAppointmentConfirmationEmail ya no debería lanzar nunca; se
        // aísla igual como red de seguridad adicional.
      }
    }

    // 7) WhatsApp — sin cambios de comportamiento respecto a la integración
    // existente (mismos controles de consentimiento de siempre).
    if (patient) {
      try {
        await sendAppointmentCreatedMessage({
          supabase,
          tenantId,
          patientId: parsed.data.patient_id,
          appointmentId: created.id,
          patientName: patient.name,
          phoneE164: patient.phone_e164 ?? null,
          whatsappConsent: Boolean(patient.whatsapp_consent),
          appointmentRemindersOptIn: Boolean(patient.appointment_reminders_opt_in),
          professionalName,
          dateLabel,
          timeLabel,
        });
      } catch {
        // Nunca dejar que un problema de mensajería afecte la respuesta de
        // creación de turno: se ignora acá a propósito. sendAppointmentCreatedMessage
        // ya deja su propia traza en appointment_messages cuando puede.
      }
    }
  }

  revalidatePath('/agenda');
  redirect(`${returnTo}&ok=Turno%20creado`);
}

export async function updateAppointment(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const parsed = parseAppointment(formData);
  if (!parsed.success || !parsed.data.id) redirect(`${returnTo}&error=Datos%20de%20turno%20inválidos`);

  const startsAt = toMendozaIso(parsed.data.starts_at_local);
  const endsAt = toMendozaIso(parsed.data.ends_at_local);
  if (new Date(endsAt) <= new Date(startsAt)) redirect(`${returnTo}&error=La%20hora%20de%20fin%20debe%20ser%20posterior`);

  await validateRelations(tenantId, parsed.data.patient_id, parsed.data.service_id);
  const { data: existing, error: existingError } = await supabase.from('appointments').select('id, status').eq('id', parsed.data.id).eq('tenant_id', tenantId).maybeSingle();
  if (existingError || !existing) redirect(`${returnTo}&error=Turno%20no%20encontrado`);
  if (existing.status === 'cancelled' || existing.status === 'cancelado') redirect(`${returnTo}&error=No%20se%20puede%20editar%20un%20turno%20cancelado`);

  // NOTA (PARTE 4 del pedido, fase futura): si el turno es online y ya tiene
  // external_calendar_event_id, acá es donde correspondería llamar a
  // updateGoogleMeetForAppointment (lib/google/calendar.ts) para mover el
  // evento de Google junto con el turno. No se implementa en esta tarea
  // para no ampliar el alcance; la función ya existe y está lista para
  // conectarse acá.
  const { error } = await supabase.from('appointments').update({
    patient_id: parsed.data.patient_id,
    service_id: parsed.data.service_id,
    starts_at: startsAt,
    ends_at: endsAt,
    modality: parsed.data.modality,
    quoted_amount: parsed.data.quoted_amount ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.id).eq('tenant_id', tenantId);

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  redirect(`${returnTo}&ok=Turno%20actualizado`);
}

export async function cancelAppointment(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect(`${returnTo}&error=Turno%20inválido`);

  // NOTA (PARTE 4 del pedido, fase futura): mismo comentario que en
  // updateAppointment — acá es donde correspondería llamar a
  // cancelGoogleMeetForAppointment si el turno cancelado tenía
  // external_calendar_event_id. No implementado en esta tarea.
  const { error } = await supabase.from('appointments').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id.data).eq('tenant_id', tenantId);
  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
  revalidatePath('/agenda');
  redirect(`${returnTo}&ok=Turno%20cancelado`);
}
