import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getDigilogixCertificate } from './certificates';
import { certificateNeedsOnboardingOrRenewal, isCertificateAvailable } from './response';
import { startProfessionalDigilogixOnboarding } from './service';
import { isValidCuil, normalizeCuil } from './validation';

export type DigilogixConnectionStatus =
  | 'disconnected'
  | 'onboarding_required'
  | 'connected'
  | 'error';

/**
 * Vinculación por profesional. No contiene secretos de Digilogix:
 * solamente identidad mínima y estado del certificado consultado al proveedor.
 * PIN, contraseña, OTP y material criptográfico permanecen en Digilogix.
 */
export type DigilogixConnection = {
  cuil: string;
  email: string | null;
  status: DigilogixConnectionStatus;
  connectedAt: string | null;
  lastCertificateCheckAt: string | null;
};

export async function getDigilogixConnection(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<DigilogixConnection | null> {
  const { data, error } = await supabase
    .from('digilogix_connections')
    .select('cuil,email,status,connected_at,last_certificate_check_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    cuil: String(data.cuil),
    email: typeof data.email === 'string' ? data.email : null,
    status: data.status as DigilogixConnectionStatus,
    connectedAt: typeof data.connected_at === 'string' ? data.connected_at : null,
    lastCertificateCheckAt:
      typeof data.last_certificate_check_at === 'string'
        ? data.last_certificate_check_at
        : null,
  };
}

async function saveConnection(
  _supabase: SupabaseClient,
  params: {
    tenantId: string;
    userId: string;
    cuil: string;
    email: string | null;
    status: DigilogixConnectionStatus;
    certificateChecked: boolean;
  },
) {
  const now = new Date().toISOString();
  const service = createSupabaseServiceClient();
  const { error } = await service.from('digilogix_connections').upsert(
    {
      tenant_id: params.tenantId,
      user_id: params.userId,
      cuil: params.cuil,
      email: params.email,
      status: params.status,
      last_certificate_check_at: params.certificateChecked ? now : null,
      connected_at: params.status === 'connected' ? now : null,
      updated_at: now,
    },
    { onConflict: 'tenant_id,user_id' },
  );

  if (error) {
    return { ok: false as const, errorMessage: 'No se pudo guardar la conexión de firma digital.' };
  }
  return { ok: true as const };
}

/**
 * Flujo autoservicio multi-tenant:
 * 1) usa la credencial técnica global de TurnIA para consultar Digilogix;
 * 2) vincula únicamente al profesional autenticado por CUIL/email;
 * 3) si no existe certificado, inicia el onboarding en Digilogix;
 * 4) nunca recibe ni persiste contraseña, PIN u OTP del profesional.
 */
export async function connectOrRefreshDigilogix(params: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  cuil: string;
  email: string | null;
  beginOnboardingWhenNeeded?: boolean;
}) {
  const cuil = normalizeCuil(params.cuil);
  if (!isValidCuil(cuil)) {
    return { ok: false as const, errorMessage: 'El CUIL debe tener 11 dígitos y ser válido.' };
  }

  const certificate = await getDigilogixCertificate({
    CodigoUnicoIdentificacion: cuil,
  });

  if (!certificate.ok) {
    await saveConnection(params.supabase, {
      tenantId: params.tenantId,
      userId: params.userId,
      cuil,
      email: params.email,
      status: 'error',
      certificateChecked: false,
    });
    return { ok: false as const, errorMessage: 'No se pudo consultar el certificado de firma digital.' };
  }

  if (isCertificateAvailable(certificate.data)) {
    const saved = await saveConnection(params.supabase, {
      tenantId: params.tenantId,
      userId: params.userId,
      cuil,
      email: params.email,
      status: 'connected',
      certificateChecked: true,
    });
    if (!saved.ok) return saved;
    return { ok: true as const, status: 'connected' as const };
  }

  if (certificateNeedsOnboardingOrRenewal(certificate.data)) {
    if (params.beginOnboardingWhenNeeded && params.email) {
      const onboarding = await startProfessionalDigilogixOnboarding({
        email: params.email,
        showPaymentStep: false,
      });
      if (!onboarding.ok || onboarding.data.CodigoResultado !== 1) {
        await saveConnection(params.supabase, {
          tenantId: params.tenantId,
          userId: params.userId,
          cuil,
          email: params.email,
          status: 'error',
          certificateChecked: true,
        });
        return { ok: false as const, errorMessage: 'Digilogix no pudo iniciar el alta del certificado.' };
      }
    }

    const saved = await saveConnection(params.supabase, {
      tenantId: params.tenantId,
      userId: params.userId,
      cuil,
      email: params.email,
      status: 'onboarding_required',
      certificateChecked: true,
    });
    if (!saved.ok) return saved;
    return { ok: true as const, status: 'onboarding_required' as const };
  }

  await saveConnection(params.supabase, {
    tenantId: params.tenantId,
    userId: params.userId,
    cuil,
    email: params.email,
    status: 'error',
    certificateChecked: true,
  });
  return { ok: false as const, errorMessage: 'Digilogix devolvió un estado de certificado no reconocido.' };
}

export async function disconnectDigilogix(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from('digilogix_connections')
    .update({
      status: 'disconnected',
      connected_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);

  return error
    ? { ok: false as const, errorMessage: 'No se pudo desconectar la firma digital.' }
    : { ok: true as const };
}
