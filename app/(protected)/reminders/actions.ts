'use server';

// Recordatorios PERSONALES del profesional (PARTE 6-9 del pedido de
// corrección funcional/UX). Completamente separado de turnos, WhatsApp y
// seguimientos de pacientes — ver comentario en la migración
// 20260916150000_professional_reminders.sql.
//
// Aislamiento (PARTE 9): toda query/mutación acá filtra EXPLÍCITAMENTE por
// tenant_id + professional_id = user.id, además de la RLS que ya lo exige a
// nivel de base — defensa en profundidad, mismo criterio que el resto de la
// app (ver agenda/actions.ts).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

// Mismo patrón que agenda/actions.ts y planning/actions.ts: el input
// datetime-local del browser se interpreta siempre en America/Argentina/
// Buenos_Aires (offset fijo -03:00, sin horario de verano en Argentina),
// nunca en el timezone del navegador de quien esté usando la app.
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

function toTzIso(local: string) {
  return new Date(`${local}:00-03:00`).toISOString();
}

const reminderSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'El título es obligatorio.').max(160),
  description: z.string().trim().max(2000).optional(),
  remind_at_local: localDateTime,
});

function safeReturn(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/reminders');
  return returnTo.startsWith('/reminders') || returnTo.startsWith('/dashboard') ? returnTo : '/reminders';
}

export async function createReminder(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const parsed = reminderSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    remind_at_local: formData.get('remind_at_local'),
  });
  if (!parsed.success) redirect(`${returnTo}?error=${encodeURIComponent(parsed.error.issues[0]?.message || 'Datos inválidos')}`);

  const { error } = await supabase.from('professional_reminders').insert({
    tenant_id: tenantId,
    professional_id: user.id,
    title: parsed.data.title,
    description: parsed.data.description || null,
    remind_at: toTzIso(parsed.data.remind_at_local),
    status: 'pending',
  });
  if (error) redirect(`${returnTo}?error=${encodeURIComponent('No se pudo crear el recordatorio.')}`);

  revalidatePath('/reminders');
  revalidatePath('/dashboard');
  redirect(`${returnTo}?ok=Recordatorio%20creado`);
}

export async function updateReminder(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const parsed = reminderSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    remind_at_local: formData.get('remind_at_local'),
  });
  if (!parsed.success || !parsed.data.id) redirect(`${returnTo}?error=${encodeURIComponent(parsed.success ? 'Recordatorio inválido' : parsed.error.issues[0]?.message || 'Datos inválidos')}`);

  const { error } = await supabase
    .from('professional_reminders')
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      remind_at: toTzIso(parsed.data.remind_at_local),
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id);
  if (error) redirect(`${returnTo}?error=${encodeURIComponent('No se pudo actualizar el recordatorio.')}`);

  revalidatePath('/reminders');
  revalidatePath('/dashboard');
  redirect(`${returnTo}?ok=Recordatorio%20actualizado`);
}

/** Posponer: mismo update, pero pensado para el atajo rápido de sólo cambiar fecha/hora. */
export async function postponeReminder(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const id = z.string().uuid().safeParse(formData.get('id'));
  const remindAt = localDateTime.safeParse(formData.get('remind_at_local'));
  if (!id.success || !remindAt.success) redirect(`${returnTo}?error=${encodeURIComponent('Fecha inválida')}`);

  const { error } = await supabase
    .from('professional_reminders')
    .update({ remind_at: toTzIso(remindAt.data), updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id);
  if (error) redirect(`${returnTo}?error=${encodeURIComponent('No se pudo posponer el recordatorio.')}`);

  revalidatePath('/reminders');
  revalidatePath('/dashboard');
  redirect(`${returnTo}?ok=Recordatorio%20pospuesto`);
}

export async function setReminderStatus(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = z.enum(['pending', 'done']).safeParse(formData.get('status'));
  if (!id.success || !status.success) redirect(`${returnTo}?error=${encodeURIComponent('Recordatorio inválido')}`);

  const { error } = await supabase
    .from('professional_reminders')
    .update({
      status: status.data,
      completed_at: status.data === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id.data)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id);
  if (error) redirect(`${returnTo}?error=${encodeURIComponent('No se pudo actualizar el recordatorio.')}`);

  revalidatePath('/reminders');
  revalidatePath('/dashboard');
  redirect(`${returnTo}?ok=${status.data === 'done' ? 'Recordatorio%20marcado%20como%20hecho' : 'Recordatorio%20reabierto'}`);
}

export async function deleteReminder(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect(`${returnTo}?error=${encodeURIComponent('Recordatorio inválido')}`);

  const { error } = await supabase
    .from('professional_reminders')
    .delete()
    .eq('id', id.data)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id);
  if (error) redirect(`${returnTo}?error=${encodeURIComponent('No se pudo eliminar el recordatorio.')}`);

  revalidatePath('/reminders');
  revalidatePath('/dashboard');
  redirect(`${returnTo}?ok=Recordatorio%20eliminado`);
}
