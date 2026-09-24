import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import {
  areDigilogixLiveCallsEnabled,
  getDigilogixConfig,
  isDigilogixFeatureVisible,
} from '@/lib/digilogix/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requireTenant();

  const config = getDigilogixConfig();

  return NextResponse.json(
    {
      visible: isDigilogixFeatureVisible(),
      configured: Boolean(config),
      liveCallsEnabled: areDigilogixLiveCallsEnabled(),
      environment: config?.baseUrl.includes('test.api.firmador.digilogix.com.ar') ? 'test' : 'custom',
      companyConfigured: Boolean(config?.companyId),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
