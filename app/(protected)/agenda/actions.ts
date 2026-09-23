'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { sendAppointmentCreatedMessage } from '@/lib/whatsapp/send-appointment-created';
import { createGoogleMeetForAppointment, updateGoogleMeetForAppointment, cancelGoogleMeetForAppointment } from '@/lib/google/calendar';
import { sendAppointmentConfirmationEmail } from '@/lib/email/send-appointment-created';
import { assertNoOverlap, assertNotInPast } from '@/lib/appointments/scheduling';
import { createMercadoPagoCheckoutForAppointment } from '@/lib/mercadopago/orders';
import { resolvePatientCommunicationName } from '@/lib/patients/communication-name';

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

  if (returnTo.startsWith('/agenda')) return returnTo;

  // También permitimos volver a una ficha de paciente concreta cuando una
  // acción de turno se inició desde allí. Se valida la ruta completa para
  // no convertir return_to en un redirect abierto.
  if (/^\/patients\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(returnTo)) {
    return returnTo;
  }

  return '/agenda';
}

function appendQueryParam(path: string, key: string, value: string) {
  return `${path}${path.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function appointmentConflictReturn(returnTo: string, parsed: z.infer<typeof appointmentSchema>, message: string) {
  const separator = returnTo.includes('?') ? '&' : '?';
  const [slot, time] = parsed.starts_at_local.split('T');
  const params = new URLSearchParams({
    error: message,
    patient: parsed.patient_id,
    service: parsed.service_id,
    slot,
    time,
    modality: parsed.modality,
    amount: parsed.quoted_amount == null ? '' : String(parsed.quoted_amount),
    new: '1',
  });
  return `${returnTo}${separator}${params.toString()}#turno-drawer`;
}

function editConflictReturn(returnTo: string, appointmentId: string, message: string) {
  const separator = returnTo.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    error: message,
    edit: appointmentId,
  });
  return `${returnTo}${separator}${params.toString()}#turno-drawer`;
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

  // PARTE 3: turno en el pasado — validado server-side contra la hora real
  // del servidor, nunca contra el input del browser.
  try {
    assertNotInPast(startsAt);
  } catch (err) {
    redirect(`${returnTo}&error=${encodeURIComponent(err instanceof Error ? err.message : 'Fecha inválida')}`);
  }

  const service = await validateRelations(tenantId, parsed.data.patient_id, parsed.data.service_id);

  // PARTE 2 (bug crítico): un profesional no puede tener dos turnos activos
  // que se superpongan en horario. Validado server-side, por tenant +
  // profesional, ignorando turnos cancelados.
  try {
    await assertNoOverlap(supabase, {
      tenantId,
      professionalId: user.id,
      startsAtIso: startsAt,
      endsAtIso: endsAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo validar el horario';
    redirect(appointmentConflictReturn(returnTo, parsed.data, message));
  }

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
      alias: string | null;
      use_alias_for_communications: boolean | null;
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
          .select('name, alias, use_alias_for_communications, email, phone_e164, whatsapp_consent, appointment_reminders_opt_in')
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
    const communicationName = patient ? resolvePatientCommunicationName(patient) : null;
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
          patientEmail: patient.email,
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

    // 5) Mercado Pago — checkout opcional para incluir en el email de
    // confirmación. Se genera (o reutiliza, vía la misma función que usa el
    // botón manual de Agenda) ANTES de armar el email, para poder pasarle un
    // checkout_url real. Aislado en su propio try/catch, igual que Google
    // Meet: un fallo acá (no conectado, sin monto, email de paciente
    // inválido, error del proveedor, etc.) NUNCA debe impedir crear el turno
    // (ya creado más arriba) ni enviar el resto del email — sólo deja
    // paymentUrl en null, y el email sale igual pero sin el bloque de pago.
    // createMercadoPagoCheckoutForAppointment ya hace todas las
    // validaciones (conexión vigente, amount server-side, email del
    // paciente, reutilización de una orden existente) — no se duplica nada
    // de esa lógica acá.
    let paymentUrl: string | null = null;
    if (patient) {
      try {
        const checkoutResult = await createMercadoPagoCheckoutForAppointment({
          tenantId,
          userId: user.id,
          appointmentId: created.id,
        });
        if (checkoutResult.ok) {
          paymentUrl = checkoutResult.checkoutUrl;
        }
      } catch (err) {
        console.error('Error inesperado generando el checkout de Mercado Pago para el email', created.id, err instanceof Error ? err.message : 'error desconocido');
      }
    }

    // 6) Email de confirmación — aislado, nunca afecta al turno ya creado.
    if (patient) {
      // El link público (Confirmar/Cancelar/Reprogramar) depende de la
      // columna `public_token`, agregada en la migración
      // 20260916140000_appointments_public_token.sql. Si esa migración
      // todavía no se aplicó en esta base, este select falla — se aísla en
      // su propio try/catch para que el email salga igual, sin los botones
      // de acción, en vez de romper toda la creación del turno.
      let publicToken: string | null = null;
      try {
        const { data: tokenRow } = await supabase
          .from('appointments')
          .select('public_token')
          .eq('id', created.id)
          .maybeSingle();
        publicToken = (tokenRow as { public_token?: string } | null)?.public_token ?? null;
      } catch {
        publicToken = null;
      }

      try {
        await sendAppointmentConfirmationEmail({
          supabase,
          tenantId,
          patientId: parsed.data.patient_id,
          appointmentId: created.id,
          patientEmail: patient.email ?? null,
          patientName: communicationName ?? patient.name,
          professionalName,
          dateLabel,
          timeLabel,
          modality: parsed.data.modality,
          meetingUrl,
          publicToken,
          paymentUrl,
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
          patientName: communicationName ?? patient.name,
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
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const parsed = parseAppointment(formData);
  if (!parsed.success || !parsed.data.id) redirect(`${returnTo}&error=Datos%20de%20turno%20inválidos`);

  const startsAt = toMendozaIso(parsed.data.starts_at_local);
  const endsAt = toMendozaIso(parsed.data.ends_at_local);
  if (new Date(endsAt) <= new Date(startsAt)) redirect(`${returnTo}&error=La%20hora%20de%20fin%20debe%20ser%20posterior`);

  try {
    assertNotInPast(startsAt);
  } catch (err) {
    redirect(`${returnTo}&error=${encodeURIComponent(err instanceof Error ? err.message : 'Fecha inválida')}`);
  }

  await validateRelations(tenantId, parsed.data.patient_id, parsed.data.service_id);

  const { data: existing, error: existingError } = await supabase
    .from('appointments')
    .select('id,status,professional_id,patient_id,starts_at,ends_at,modality,meeting_url,external_calendar_event_id,public_token')
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existingError || !existing) redirect(`${returnTo}&error=Turno%20no%20encontrado`);
  if (existing.status === 'cancelled' || existing.status === 'cancelado') {
    redirect(`${returnTo}&error=No%20se%20puede%20editar%20un%20turno%20cancelado`);
  }

  const schedulingChanged =
    existing.starts_at !== startsAt ||
    existing.ends_at !== endsAt;

  try {
    await assertNoOverlap(supabase, {
      tenantId,
      professionalId: existing.professional_id,
      startsAtIso: startsAt,
      endsAtIso: endsAt,
      excludeAppointmentId: parsed.data.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo validar el horario';
    redirect(editConflictReturn(returnTo, parsed.data.id, message));
  }

  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      patient_id: parsed.data.patient_id,
      service_id: parsed.data.service_id,
      starts_at: startsAt,
      ends_at: endsAt,
      modality: parsed.data.modality,
      quoted_amount: parsed.data.quoted_amount ?? null,
      ...(schedulingChanged
        ? { reschedule_requested_at: null, reschedule_note: null }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .select('id,patient_id,starts_at,ends_at,modality,meeting_url,external_calendar_event_id,public_token')
    .maybeSingle();

  if (error || !updated) {
    redirect(`${returnTo}&error=${encodeURIComponent(error?.message || 'No se pudo guardar el cambio del turno')}`);
  }

  // Integraciones posteriores al guardado: nunca revierten el turno.
  let patient: {
    name: string;
    alias: string | null;
    use_alias_for_communications: boolean | null;
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
        .select('name,alias,use_alias_for_communications,email,phone_e164,whatsapp_consent,appointment_reminders_opt_in')
        .eq('id', parsed.data.patient_id)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    ]);
    patient = patientRow ?? null;
    professionalName = profile?.display_name || user.email || 'tu profesional';
  } catch {
    patient = null;
  }

  let meetingUrl: string | null = updated.meeting_url ?? null;
  let externalCalendarEventId: string | null = updated.external_calendar_event_id ?? null;

  // Pasó a online y todavía no tiene Meet: crear evento/Meet ahora.
  if (patient && parsed.data.modality === 'online' && !externalCalendarEventId) {
    try {
      const meetResult = await createGoogleMeetForAppointment({
        tenantId,
        professionalUserId: existing.professional_id ?? user.id,
        appointmentId: updated.id,
        summary: `Turno TurnIA: ${patient.name} con ${professionalName}`,
        startsAtIso: startsAt,
        endsAtIso: endsAt,
        timeZone: MESSAGING_TZ,
        patientEmail: patient.email,
      });

      if (meetResult.ok) {
        meetingUrl = meetResult.meetUrl;
        externalCalendarEventId = meetResult.eventId;
        await supabase
          .from('appointments')
          .update({
            meeting_provider: 'google_meet',
            meeting_url: meetResult.meetUrl,
            external_calendar_event_id: meetResult.eventId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', updated.id)
          .eq('tenant_id', tenantId);
      }
    } catch {
      // El turno ya quedó guardado; Google no puede deshacerlo.
    }
  } else if (parsed.data.modality === 'online' && externalCalendarEventId) {
    // Ya era online: si cambió fecha/hora, mantener el evento sincronizado.
    try {
      await updateGoogleMeetForAppointment({
        tenantId,
        professionalUserId: existing.professional_id ?? user.id,
        externalCalendarEventId,
        startsAtIso: startsAt,
        endsAtIso: endsAt,
        timeZone: MESSAGING_TZ,
      });
    } catch {
      // No bloquear el guardado del turno.
    }
  } else if (parsed.data.modality !== 'online' && externalCalendarEventId) {
    // Dejó de ser online: eliminar el evento de Google y limpiar el Meet.
    try {
      await cancelGoogleMeetForAppointment({
        tenantId,
        professionalUserId: existing.professional_id ?? user.id,
        externalCalendarEventId,
      });
    } catch {
      // No bloquear el guardado del turno.
    }

    meetingUrl = null;
    externalCalendarEventId = null;
    await supabase
      .from('appointments')
      .update({
        meeting_provider: null,
        meeting_url: null,
        external_calendar_event_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', updated.id)
      .eq('tenant_id', tenantId);
  }

  // Reenviar la confirmación con los datos ACTUALIZADOS.
  if (patient) {
    const communicationName = resolvePatientCommunicationName(patient);
    const dateLabel = formatAppointmentDateLabel(startsAt);
    const timeLabel = formatAppointmentTimeLabel(startsAt);

    try {
      await sendAppointmentConfirmationEmail({
        supabase,
        tenantId,
        patientId: parsed.data.patient_id,
        appointmentId: updated.id,
        patientEmail: patient.email ?? null,
        patientName: communicationName,
        professionalName,
        dateLabel,
        timeLabel,
        modality: parsed.data.modality,
        meetingUrl,
        publicToken: updated.public_token ?? existing.public_token ?? null,
      });
    } catch {
      // El cambio ya está guardado.
    }

    try {
      await sendAppointmentCreatedMessage({
        supabase,
        tenantId,
        patientId: parsed.data.patient_id,
        appointmentId: updated.id,
        patientName: communicationName,
        phoneE164: patient.phone_e164 ?? null,
        whatsappConsent: Boolean(patient.whatsapp_consent),
        appointmentRemindersOptIn: Boolean(patient.appointment_reminders_opt_in),
        professionalName,
        dateLabel,
        timeLabel,
      });
    } catch {
      // El cambio ya está guardado.
    }
  }

  revalidatePath('/agenda');
  revalidatePath(`/patients/${parsed.data.patient_id}`);
  redirect(`${returnTo}&ok=Turno%20actualizado%20y%20comunicaciones%20procesadas`);
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

// FASE 3 de Mercado Pago (mejorada): genera (o reutiliza, si ya existe una
// orden todavía utilizable para este turno) una orden de cobro Checkout Pro,
// usando la conexión OAuth del profesional dueño de ese turno, y REDIRIGE
// DE UNA al checkout_url de Mercado Pago — un único click desde Agenda o
// desde el turno abierto, sin pasar primero por una pantalla intermedia de
// "cobro generado" con un segundo botón "Abrir Mercado Pago".
//
// Toda la lógica de seguridad (service-role, amount server-side,
// idempotencia, no duplicar órdenes, validación de checkout_url contra
// isTrustedMercadoPagoCheckoutUrl) vive en lib/mercadopago/orders.ts — esta
// acción sólo valida el input del form, llama a esa función UNA vez y
// redirige con el checkoutUrl que esa función ya validó. Nunca redirige a
// una URL recibida del browser/formData: el único destino posible es
// result.checkoutUrl, devuelto por createMercadoPagoCheckoutForAppointment.
// Nunca expone el access_token ni construye la request a Mercado Pago acá.
export async function generateMercadoPagoCheckout(formData: FormData) {
  const { user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const id = z.string().uuid().safeParse(formData.get('appointment_id'));
  if (!id.success) redirect(appendQueryParam(returnTo, 'error', 'Turno inválido'));

  const result = await createMercadoPagoCheckoutForAppointment({
    tenantId,
    userId: user.id,
    appointmentId: id.data,
  });

  if (!result.ok) redirect(appendQueryParam(returnTo, 'error', result.message));

  revalidatePath('/agenda');
  if (returnTo.startsWith('/patients/')) revalidatePath(returnTo);
  redirect(result.checkoutUrl);
}
