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
import {
  getMisRxHomologationConfig,
  isMisRxProductionIssuingEnabled,
} from '@/lib/misrx/homologation';

export async function GET() {
  const { user, tenantId } = await requireTenant();

  const connection = await getMisRxConnectionSummary({
    tenantId,
    userId: user.id,
  });

  const credentialStorageReady = isMisRxConnectionConfigured();
  const issuingConfigurationReady = isMisRxProviderConfigured();
  const onboardingConfigurationReady = isMisRxOnboardingConfigured();
  const homologation = getMisRxHomologationConfig();
  const productionIssuingEnabled = isMisRxProductionIssuingEnabled();
  const liveIssuingEnabled = homologation.enabled
    ? homologation.issuingEnabled
    : productionIssuingEnabled;

  return NextResponse.json({
    provider: 'misrx',
    phase: issuingConfigurationReady ? 'provider_ready' : 'foundation',
    available: true,
    credentialStorageReady,
    issuingConfigurationReady,
    onboardingConfigurationReady,
    professionalConnected: connection?.status === 'connected',
    connectionStatus: connection?.status ?? 'not_connected',
    liveIssuingEnabled,
    homologationEnabled: homologation.enabled,
    productionIssuingEnabled,
    missingConfiguration: {
      credentialEncryption: !credentialStorageReady,
      softId: !issuingConfigurationReady,
      appIdForOnboarding: !onboardingConfigurationReady,
    },
    message: issuingConfigurationReady
      ? liveIssuingEnabled
        ? 'La configuración técnica para prescripción externa está preparada y el entorno tiene habilitada la emisión.'
        : 'La configuración técnica para prescripción externa está preparada. La emisión permanece bloqueada por la compuerta de seguridad del entorno.'
      : 'La estructura de MisRX está instalada. La emisión real permanece deshabilitada hasta completar el soft_id oficial y la conexión del profesional.',
  });
}
