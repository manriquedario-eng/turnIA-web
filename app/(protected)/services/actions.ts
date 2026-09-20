'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const serviceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  duration_minutes: z.coerce.number().int().positive().max(1440),
  price: z.coerce.number().nonnegative().optional(),
  deposit: z.coerce.number().nonnegative().optional(),
  currency: z.string().trim().min(3).max(3).default('ARS'),
});

function safeReturn(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/services');
  return returnTo.startsWith('/services') ? returnTo : '/services';
}

export async function createService(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);

  const parsed = serviceSchema.safeParse({
    name: formData.get('name'),
    duration_minutes: formData.get('duration_minutes'),
    price: formData.get('price') || undefined,
    deposit: formData.get('deposit') || undefined,
    currency: formData.get('currency') || 'ARS',
  });

  if (!parsed.success) redirect(`${returnTo}?error=Datos%20de%20servicio%20inválidos`);

  const { error } = await supabase.from('services').insert({
    tenant_id: tenantId,
    name: parsed.data.name,
    duration_minutes: parsed.data.duration_minutes,
    price: parsed.data.price ?? null,
    deposit: parsed.data.deposit ?? null,
    currency: parsed.data.currency.toUpperCase(),
  });

  if (error) redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/services');
  revalidatePath('/agenda');
  redirect(`${returnTo}?ok=Servicio%20creado`);
}

export async function updateService(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const returnTo = safeReturn(formData);

  const parsed = serviceSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    duration_minutes: formData.get('duration_minutes'),
    price: formData.get('price') || undefined,
    deposit: formData.get('deposit') || undefined,
    currency: formData.get('currency') || 'ARS',
  });

  if (!parsed.success || !parsed.data.id) redirect(`${returnTo}?error=Datos%20de%20servicio%20inválidos`);

  const { data: existing, error: existingError } = await supabase
    .from('services')
    .select('id')
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existingError || !existing) redirect(`${returnTo}?error=Servicio%20no%20encontrado`);

  const { error } = await supabase
    .from('services')
    .update({
      name: parsed.data.name,
      duration_minutes: parsed.data.duration_minutes,
      price: parsed.data.price ?? null,
      deposit: parsed.data.deposit ?? null,
      currency: parsed.data.currency.toUpperCase(),
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId);

  if (error) redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/services');
  revalidatePath('/agenda');
  redirect(`${returnTo}?ok=Servicio%20actualizado`);
}
