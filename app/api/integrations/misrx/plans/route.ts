import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';

function positiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const { tenantId, user } = await requireTenant();
  const convenioId = positiveInteger(request.nextUrl.searchParams.get('convenio_id'));
  const afiliadoId = positiveInteger(request.nextUrl.searchParams.get('afiliado_id'));

  if (!convenioId) {
    return NextResponse.json({ error: 'Falta convenio_id válido.' }, { status: 400 });
  }

  const limit = await checkRateLimit({
    scope: 'misrx-plans-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 30,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas. Intentá nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const result = await adapterResult.data.getPlans({
    convenioId,
    affiliateId: afiliadoId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
