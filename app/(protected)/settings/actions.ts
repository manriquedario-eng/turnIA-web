'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { disconnectGoogleOAuthConnection } from '@/lib/google/oauth';
import { disconnectMercadoPagoOAuthConnection } from '@/lib/mercadopago/oauth';
import {
  saveArcaConnection as saveArcaConnectionCore,
  testArcaConnection as testArcaConnectionCore,
  updateArcaBillingPreferences as updateArcaBillingPreferencesCore,
} from '@/lib/arca/wsaa';

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
  activity_code: optionalProfileField,
  activity_description: optionalProfileField,
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
      activity_code: parsed.data.activity_code ?? null,
      activity_description: parsed.data.activity_description ?? null,
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

/**
 * Desconecta Mercado Pago del profesional logueado. A diferencia de
 * Google, Mercado Pago no ofrece revocación remota programática (ver
 * lib/mercadopago/oauth.ts) — disconnectMercadoPagoOAuthConnection hace
 * únicamente limpieza local (borra la conexión guardada, TurnIA deja de
 * poder usarla de inmediato). El mensaje de éxito nunca da a entender que
 * también se revocó del lado de Mercado Pago.
 */
export async function disconnectMercadoPago() {
  const { user, tenantId } = await requireTenant();

  const result = await disconnectMercadoPagoOAuthConnection({ tenantId, userId: user.id });
  if (!result.ok) {
    redirect(`/settings?error=${encodeURIComponent(result.errorMessage)}#integraciones`);
  }

  revalidatePath('/settings');
  redirect('/settings?ok=Mercado%20Pago%20desconectado#integraciones');
}


export async function updateAiTranscriptionSetting(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();
  const enabled = formData.get('enabled') === 'true';

  const { error } = await supabase
    .from('ai_transcription_accounts')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);

  if (error) {
    redirect(`/settings?error=${encodeURIComponent('No se pudo actualizar Transcripción IA.')}`);
  }

  revalidatePath('/settings');
  redirect(
    enabled
      ? '/settings?ok=Transcripción%20IA%20activada'
      : '/settings?ok=Transcripción%20IA%20desactivada'
  );
}

// ---------------------------------------------------------------------------
// Facturación ARCA — Fase 1 (sólo WSAA en homologación, ver informe de
// arquitectura). El ambiente queda FIJO a 'homologacion' acá — ningún campo
// del formulario ni parámetro de esta acción permite elegir otro; eso es
// deliberado hasta que se habilite una fase de producción explícita.
//
// Certificado y clave privada llegan como `File` (inputs type="file" del
// formulario, ver page.tsx) — su contenido se lee acá, server-side, directo
// del FormData. Nunca pasan por JS del browser, nunca se guardan en
// localStorage, nunca se exponen como NEXT_PUBLIC_.
// ---------------------------------------------------------------------------

const arcaConnectionSchema = z.object({
  cuit: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{11}$/, 'El CUIT debe tener 11 dígitos')),
  // Nullable/opcional a propósito: WSAA (Fase 1) sólo autentica, no necesita
  // punto de venta — se exigirá recién en Fase 2 con WSFEv1.
  punto_venta: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
});

async function readPemFile(formData: FormData, fieldName: string): Promise<string | null> {
  const file = formData.get(fieldName);
  if (!(file instanceof File) || file.size === 0) return null;
  const text = await file.text();
  return text.trim() || null;
}

export async function saveArcaConnection(formData: FormData) {
  const { user, tenantId } = await requireTenant();

  const parsed = arcaConnectionSchema.safeParse({
    cuit: formData.get('cuit'),
    punto_venta: formData.get('punto_venta'),
  });

  if (!parsed.success) {
    redirect(`/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Datos inválidos')}#facturacion`);
  }

  const certificatePem = await readPemFile(formData, 'certificate_file');
  const privateKeyPem = await readPemFile(formData, 'private_key_file');

  if (!certificatePem || !privateKeyPem) {
    redirect('/settings?error=Cargá%20el%20certificado%20y%20la%20clave%20privada#facturacion');
  }

  const result = await saveArcaConnectionCore({
    tenantId,
    userId: user.id,
    cuit: parsed.data.cuit,
    puntoVenta: parsed.data.punto_venta ?? null,
    certificatePem,
    privateKeyPem,
  });

  if (!result.ok) {
    redirect(`/settings?error=${encodeURIComponent(result.errorMessage)}#facturacion`);
  }

  revalidatePath('/settings');
  redirect('/settings?ok=Credenciales%20ARCA%20guardadas.%20Prob%C3%A1%20la%20conexi%C3%B3n%20para%20confirmar.#facturacion');
}

export async function testArcaConnection() {
  const { user, tenantId } = await requireTenant();

  const result = await testArcaConnectionCore({ tenantId, userId: user.id });

  if (!result.ok) {
    redirect(`/settings?error=${encodeURIComponent(result.errorMessage)}#facturacion`);
  }

  revalidatePath('/settings');
  redirect('/settings?ok=Conexi%C3%B3n%20con%20ARCA%20exitosa#facturacion');
}


const arcaBillingPreferencesSchema = z.object({
  punto_venta: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.coerce.number().int().positive().nullable(),
  ),
  activity_code: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(40).nullable(),
  ),
  activity_description: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(240).nullable(),
  ),
});

export async function updateArcaBillingPreferences(formData: FormData) {
  const { user, tenantId } = await requireTenant();

  const parsed = arcaBillingPreferencesSchema.safeParse({
    punto_venta: formData.get('punto_venta'),
    activity_code: formData.get('activity_code'),
    activity_description: formData.get('activity_description'),
  });

  if (!parsed.success) {
    redirect(`/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Preferencias ARCA inválidas')}#facturacion`);
  }

  const result = await updateArcaBillingPreferencesCore({
    tenantId,
    userId: user.id,
    puntoVenta: parsed.data.punto_venta,
    activityCode: parsed.data.activity_code,
    activityDescription: parsed.data.activity_description,
  });

  if (!result.ok) {
    redirect(`/settings?error=${encodeURIComponent(result.errorMessage)}#facturacion`);
  }

  revalidatePath('/settings');
  revalidatePath('/billing');
  redirect('/settings?ok=Preferencias%20de%20facturaci%C3%B3n%20ARCA%20guardadas#facturacion');
}
