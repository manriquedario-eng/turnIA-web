import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import {
  isMisRxConnectionConfigured,
  getMisRxConnectionSummary,
} from '@/lib/misrx/connection';
import { isMisRxProviderConfigured } from '@/lib/misrx/service';

export async function GET() {
  const { user, tenantId } = await requireTenant();

  const connection = await getMisRxConnectionSummary({
    tenantId,
    userId: user.id,
  });

  const credentialStorageReady = isMisRxConnectionConfigured();
  const providerReady = isMisRxProviderConfigured();

  return NextResponse.json({
    provider: 'misrx',
    phase: providerReady ? 'provider_ready' : 'foundation',
    available: true,
    credentialStorageReady,
    providerReady,
    professionalConnected: connection?.status === 'connected',
    connectionStatus: connection?.status ?? 'not_connected',
    liveIssuingEnabled: false,
    missingConfiguration: {
      credentialEncryption: !credentialStorageReady,
      appIdOrSoftId: !providerReady,
    },
    message: providerReady
      ? 'La configuración técnica de MisRX está completa. La emisión real continúa deshabilitada hasta validar homologación y credenciales oficiales.'
      : 'La estructura de MisRX está instalada. La emisión real permanece deshabilitada hasta completar la configuración oficial.',
  });
}
