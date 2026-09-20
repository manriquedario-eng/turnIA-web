import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { getWsfeParametersSnapshot } from '@/lib/arca/wsfe';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, tenantId } = await requireTenant();

  const result = await getWsfeParametersSnapshot({
    tenantId,
    userId: user.id,
    environment: 'homologacion',
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.errorMessage, reason: result.reason },
      { status: result.reason === 'not_connected' || result.reason === 'not_configured' ? 400 : 502 },
    );
  }

  return NextResponse.json(
    { ok: true, data: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
