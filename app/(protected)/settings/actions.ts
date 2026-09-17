'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { disconnectGoogleOAuthConnection } from '@/lib/google/oauth';

// Campos profesionales opcionales. NO se agregó ninguna columna nueva a la
// base: `settings.profile` ya era una columna jsonb existente en el schema
// (se leía en este mismo archivo pero no se usaba para nada todavía), así
// que estos campos viven ahí — sin migración. Todos opcionales y en blanco
// por defecto: nunca se inventa ni se precarga un valor que la persona no
// cargó.
const optionalProfileField = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(200).optional(),
);

const settingsSchema = z.object({
  display_name: z.string().trim().min(2).max(120),
  default_modality: z.enum(['presencial', 'domicilio', 'online']),
  workday_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  workday_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  // Datos profesionales
  profession: optionalProfileField,
  license_number: optionalProfileField,
  professional_college: optionalProfileField,
  cuit: optionalProfileField,
  business_name: optionalProfileField,
  tax_condition: optionalProfileField,
  // Datos de contacto
  professional_phone: optionalProfileField,
  professional_email: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().email().max(200).optional(),
  ),
  office_address: optionalProfileField,
  locality: optionalProfileField,
  province: optionalProfileField,
});

export async function updateSettings(formData: FormData) {
  const { supabase, user, tenantId } = await requireTenant();

  const parsed = settingsSchema.safeParse({
    display_name: formData.get('display_name'),
    default_modality: formData.get('default_modality'),
    workday_start: formData.get('workday_start'),
    workday_end: formData.get('workday_end'),
    profession: formData.get('profession'),
    license_number: formData.get('license_number'),
    professional_college: formData.get('professional_college'),
    cuit: formData.get('cuit'),
    business_name: formData.get('business_name'),
    tax_condition: formData.get('tax_condition'),
    professional_phone: formData.get('professional_phone'),
    professional_email: formData.get('professional_email'),
    office_address: formData.get('office_address'),
    locality: formData.get('locality'),
    province: formData.get('province'),
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
    profile: {
      ...currentProfile,
      profession: parsed.data.profession ?? null,
      license_number: parsed.data.license_number ?? null,
      professional_college: parsed.data.professional_college ?? null,
      cuit: parsed.data.cuit ?? null,
      business_name: parsed.data.business_name ?? null,
      tax_condition: parsed.data.tax_condition ?? null,
      professional_phone: parsed.data.professional_phone ?? null,
      professional_email: parsed.data.professional_email ?? null,
      office_address: parsed.data.office_address ?? null,
      locality: parsed.data.locality ?? null,
      province: parsed.data.province ?? null,
    },
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

/**
 * Desconecta Google Calendar del profesional logueado. Intenta revocar la
 * autorización del lado de Google (ver disconnectGoogleOAuthConnection) y,
 * pase lo que pase con esa revocación remota, TurnIA deja de usar la
 * conexión localmente. Nunca se muestra "Google desconectado" sin más si no
 * se pudo confirmar la revocación remota — en ese caso se avisa,
 * sin detalles técnicos, que la conexión local se eliminó pero la
 * revocación en Google no pudo confirmarse.
 */
export async function disconnectGoogleCalendar() {
  const { user, tenantId } = await requireTenant();

  const result = await disconnectGoogleOAuthConnection({ tenantId, userId: user.id });
  if (!result.ok) {
    redirect(`/settings?error=${encodeURIComponent(result.errorMessage)}#integraciones`);
  }

  revalidatePath('/settings');

  if (!result.data.googleRevocationConfirmed) {
    redirect(
      `/settings?error=${encodeURIComponent('Google fue desconectado de TurnIA, pero no pudimos confirmar la revocación del permiso en Google.')}#integraciones`
    );
  }

  redirect('/settings?ok=Google%20desconectado#integraciones');
}
