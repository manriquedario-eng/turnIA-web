import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import {
  getMisRxConnectionSummary,
  isMisRxConnectionConfigured,
} from '@/lib/misrx/connection';
import {
  isMisRxOnboardingConfigured,
  isMisRxProviderConfigured,
} from '@/lib/misrx/service';

export async function GET() {
  const { user, tenantId } = await requireTenant();

  const connection = await getMisRxConnectionSummary({
    tenantId,
    userId: user.id,
  });

  const credentialStorageReady = isMisRxConnectionConfigured();
  const issuingConfigurationReady = isMisRxProviderConfigured();
  const onboardingConfigurationReady = isMisRxOnboardingConfigured();

  return NextResponse.json({
    provider: 'misrx',
    phase: issuingConfigurationReady ? 'provider_ready' : 'foundation',
    available: true,
    credentialStorageReady,
    issuingConfigurationReady,
    onboardingConfigurationReady,
    professionalConnected: connection?.status === 'connected',
    connectionStatus: connection?.status ?? 'not_connected',
    liveIssuingEnabled: false,
    missingConfiguration: {
      credentialEncryption: !credentialStorageReady,
      softId: !issuingConfigurationReady,
      appIdForOnboarding: !onboardingConfigurationReady,
    },
    message: issuingConfigurationReady
      ? 'La configuración técnica para prescripción externa está preparada. La emisión real continúa deshabilitada hasta validar homologación y credenciales oficiales.'
      : 'La estructura de MisRX está instalada. La emisión real permanece deshabilitada hasta completar el soft_id oficial y la conexión del profesional.',
  });
}
