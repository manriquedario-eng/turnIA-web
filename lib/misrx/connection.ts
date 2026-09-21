import 'server-only';

import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { loginToMisRx } from './auth';
import {
  decryptMisRxCredential,
  encryptMisRxCredential,
  isMisRxCredentialEncryptionConfigured,
} from './credential-crypto';
import type { MisRxApiResult } from './types';

type ConnectionSummary = {
  username: string;
  accountLabel: string | null;
  status: 'connected' | 'not_connected' | 'error';
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
};

function configured(): boolean {
  return isServiceRoleConfigured() && isMisRxCredentialEncryptionConfigured();
}

export function isMisRxConnectionConfigured(): boolean {
  return configured();
}

export async function getMisRxConnectionSummary(params: {
  tenantId: string;
  userId: string;
}): Promise<ConnectionSummary | null> {
  if (!configured()) return null;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('misrx_connections')
    .select('username,account_label,status,connected_at,last_verified_at,last_error')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    username: data.username,
    accountLabel: data.account_label,
    status: data.status,
    connectedAt: data.connected_at,
    lastVerifiedAt: data.last_verified_at,
    lastError: data.last_error,
  };
}

export async function connectMisRx(params: {
  tenantId: string;
  userId: string;
  username: string;
  password: string;
}): Promise<MisRxApiResult<{ accountLabel: string }>> {
  if (!configured()) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'La integración MisRX todavía no está configurada en el servidor.',
    };
  }

  const username = params.username.trim();
  const password = params.password;
  if (!username || !password) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'Ingresá usuario y contraseña de MisRX.',
    };
  }

  // Primero se valida contra MisRX. Si el login falla, no persistimos la
  // contraseña ni dejamos una conexión local que parezca válida.
  const login = await loginToMisRx({ username, password });
  if (!login.ok) return login;

  const encrypted = encryptMisRxCredential(password);
  if (!encrypted.ok) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo guardar la conexión de MisRX de forma segura.',
    };
  }

  const now = new Date().toISOString();
  const accountLabel =
    login.data.usuario?.trim() ||
    login.data.descripcion?.trim() ||
    username;

  const service = createSupabaseServiceClient();

  const { error: connectionError } = await service
    .from('misrx_connections')
    .upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        username,
        password_ciphertext: encrypted.data,
        encryption_key_version: 1,
        misrx_usuario_id: login.data.usuario_id ?? null,
        misrx_propio_id: login.data.propio_id ?? null,
        account_label: accountLabel,
        status: 'connected',
        last_verified_at: now,
        last_error: null,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'tenant_id,user_id' },
    );

  if (connectionError) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo guardar la conexión de MisRX.',
    };
  }

  const { error: statusError } = await service
    .from('integration_status')
    .upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        provider: 'misrx',
        status: 'connected',
        account_label: accountLabel,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'tenant_id,user_id,provider' },
    );

  if (statusError) {
    // Evitamos estado parcial: si no pudimos reflejar la conexión en
    // integration_status, eliminamos las credenciales recién guardadas.
    // Así Settings nunca muestra "no conectado" mientras una contraseña
    // válida quedó persistida en segundo plano.
    await service
      .from('misrx_connections')
      .delete()
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId);

    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'La conexión se validó, pero no se pudo guardar de forma consistente en TurnIA.',
    };
  }

  return { ok: true, data: { accountLabel } };
}

export async function testStoredMisRxConnection(params: {
  tenantId: string;
  userId: string;
}): Promise<MisRxApiResult<{ accountLabel: string }>> {
  if (!configured()) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'La integración MisRX todavía no está configurada en el servidor.',
    };
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('misrx_connections')
    .select('username,password_ciphertext')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'No hay una conexión MisRX guardada para este profesional.',
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

  const login = await loginToMisRx({
    username: data.username,
    password: decrypted.data,
  });

  const now = new Date().toISOString();

  if (!login.ok) {
    await service
      .from('misrx_connections')
      .update({
        status: 'error',
        last_verified_at: now,
        last_error: login.errorMessage.slice(0, 500),
        updated_at: now,
      })
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId);

    await service
      .from('integration_status')
      .upsert(
        {
          tenant_id: params.tenantId,
          user_id: params.userId,
          provider: 'misrx',
          status: 'error',
          updated_at: now,
        },
        { onConflict: 'tenant_id,user_id,provider' },
      );

    return login;
  }

  const accountLabel =
    login.data.usuario?.trim() ||
    login.data.descripcion?.trim() ||
    data.username;

  await service
    .from('misrx_connections')
    .update({
      misrx_usuario_id: login.data.usuario_id ?? null,
      misrx_propio_id: login.data.propio_id ?? null,
      account_label: accountLabel,
      status: 'connected',
      last_verified_at: now,
      last_error: null,
      connected_at: now,
      updated_at: now,
    })
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId);

  await service
    .from('integration_status')
    .upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        provider: 'misrx',
        status: 'connected',
        account_label: accountLabel,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'tenant_id,user_id,provider' },
    );

  return { ok: true, data: { accountLabel } };
}

export async function disconnectMisRx(params: {
  tenantId: string;
  userId: string;
}): Promise<MisRxApiResult<{ disconnected: true }>> {
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'La integración MisRX todavía no está configurada en el servidor.',
    };
  }

  const service = createSupabaseServiceClient();
  const { error: deleteError } = await service
    .from('misrx_connections')
    .delete()
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId);

  if (deleteError) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo eliminar la conexión local de MisRX.',
    };
  }

  const { error: statusError } = await service
    .from('integration_status')
    .upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        provider: 'misrx',
        status: 'not_connected',
        account_label: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,user_id,provider' },
    );

  if (statusError) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo actualizar el estado local de MisRX.',
    };
  }

  return { ok: true, data: { disconnected: true } };
}
