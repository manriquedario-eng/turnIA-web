'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const paymentSchema = z.object({
  appointment_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  method: z.string().trim().min(1).max(60),
  idempotency_key: z.string().trim().min(8).max(120),
});

const cashSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.string().trim().min(1).max(60),
  kind: z.enum(['in', 'out']),
});

export async function registerPayment(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const parsed = paymentSchema.safeParse({
    appointment_id: formData.get('appointment_id'),
    amount: formData.get('amount'),
    method: formData.get('method'),
    idempotency_key: formData.get('idempotency_key'),
  });

  if (!parsed.success) redirect('/payments?error=Datos%20de%20pago%20inválidos');

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .select('id, patient_id, currency')
    .eq('id', parsed.data.appointment_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (appointmentError || !appointment) redirect('/payments?error=Turno%20inválido');

  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', parsed.data.idempotency_key)
    .maybeSingle();

  if (existing) redirect('/payments?ok=Pago%20ya%20registrado');

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      tenant_id: tenantId,
      appointment_id: appointment.id,
      patient_id: appointment.patient_id,
      amount: parsed.data.amount,
      currency: appointment.currency || 'ARS',
      method: parsed.data.method,
      idempotency_key: parsed.data.idempotency_key,
    })
    .select('id')
    .single();

  if (paymentError || !payment) redirect(`/payments?error=${encodeURIComponent(paymentError?.message || 'No se pudo registrar el pago')}`);

  const { error: cashError } = await supabase.from('cash_movements').insert({
    tenant_id: tenantId,
    payment_id: payment.id,
    amount: parsed.data.amount,
    method: parsed.data.method,
    kind: 'in',
  });

  if (cashError) redirect(`/payments?error=${encodeURIComponent('Pago registrado, pero falló su movimiento de caja')}`);

  revalidatePath('/payments');
  revalidatePath('/dashboard');
  redirect('/payments?ok=Pago%20registrado');
}

export async function registerCashMovement(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const parsed = cashSchema.safeParse({
    amount: formData.get('amount'),
    method: formData.get('method'),
    kind: formData.get('kind'),
  });

  if (!parsed.success) redirect('/payments?error=Movimiento%20inválido');

  const { error } = await supabase.from('cash_movements').insert({
    tenant_id: tenantId,
    payment_id: null,
    amount: parsed.data.amount,
    method: parsed.data.method,
    kind: parsed.data.kind,
  });

  if (error) redirect(`/payments?error=${encodeURIComponent(error.message)}`);

  revalidatePath('/payments');
  revalidatePath('/dashboard');
  redirect('/payments?ok=Movimiento%20registrado');
}
