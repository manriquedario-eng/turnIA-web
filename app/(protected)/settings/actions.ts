'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';

const settingsSchema = z.object({
  display_name: z.string().trim().min(2).max(120),
  default_modality: z.enum(['presencial', 'domicilio', 'online']),
  workday_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  workday_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export async function updateSettings(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();

  const parsed = settingsSchema.safeParse({
    display_name: formData.get('display_name'),
    default_modality: formData.get('default_modality'),
    workday_start: formData.get('workday_start'),
    workday_end: formData.get('workday_end'),
  });

  if (!parsed.success) redirect('/settings?error=Configuración%20inválida');
  if (parsed.data.workday_end <= parsed.data.workday_start) {
    redirect('/settings?error=El%20fin%20de%20jornada%20debe%20ser%20posterior%20al%20inicio');
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ display_name: parsed.data.display_name })
    .eq('id', user.id);

  if (profileError) redirect(`/settings?error=${encodeURIComponent(profileError.message)}`);

  const { data: current, error: currentError } = await supabase
    .from('settings')
    .select('profile, preferences')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (currentError) redirect(`/settings?error=${encodeURIComponent(currentError.message)}`);

  const currentProfile = current?.profile && typeof current.profile === 'object' ? current.profile : {};
  const currentPreferences = current?.preferences && typeof current.preferences === 'object' ? current.preferences : {};

  const { error: settingsError } = await supabase.from('settings').upsert({
    tenant_id: tenantId,
    profile: currentProfile,
    preferences: {
      ...currentPreferences,
      default_modality: parsed.data.default_modality,
      workday_start: parsed.data.workday_start,
      workday_end: parsed.data.workday_end,
    },
  }, { onConflict: 'tenant_id' });

  if (settingsError) redirect(`/settings?error=${encodeURIComponent(settingsError.message)}`);

  revalidatePath('/settings');
  revalidatePath('/agenda');
  redirect('/settings?ok=Configuración%20guardada');
}
