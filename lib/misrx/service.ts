import 'server-only';

import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { MisRxAdapter } from './adapter';
import { decryptMisRxCredential, isMisRxCredentialEncryptionConfigured } from './credential-crypto';
import type { MisRxApiResult } from './types';

function providerConfig() {
  return {
    appId: process.env.MISRX_APP_ID?.trim() || undefined,
    softId: process.env.MISRX_SOFT_ID?.trim() || undefined,
  };
}

export function isMisRxProviderConfigured(): boolean {
  const provider = providerConfig();
  return Boolean(
    isServiceRoleConfigured() &&
    isMisRxCredentialEncryptionConfigured() &&
    provider.appId &&
    provider.softId
  );
}

export async function getMisRxAdapterForUser(params: {
  tenantId: string;
  userId: string;
}): Promise<MisRxApiResult<MisRxAdapter>> {
  if (!isServiceRoleConfigured() || !isMisRxCredentialEncryptionConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'La integración MisRX no está configurada en el servidor.',
    };
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('misrx_connections')
    .select('username,password_ciphertext,status')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (error || !data || data.status !== 'connected') {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'El profesional no tiene una conexión MisRX activa.',
    };
  }

  const decrypted = decryptMisRxCredential(data.password_ciphertext);
  if (!decrypted.ok) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudieron leer las credenciales MisRX de forma segura.',
    };
  }

  return {
    ok: true,
    data: new MisRxAdapter(
      { username: data.username, password: decrypted.data },
      providerConfig(),
    ),
  };
}
