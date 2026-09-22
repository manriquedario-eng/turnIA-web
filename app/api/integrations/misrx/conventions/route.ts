import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';
import { getMisRxHomologationConfig } from '@/lib/misrx/homologation';

export async function GET(request: NextRequest) {
  const { tenantId, user } = await requireTenant();

  const limit = await checkRateLimit({
    scope: 'misrx-conventions-user',
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

  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  const result = await adapterResult.data.getEnabledConventions(query);

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  const homologation = getMisRxHomologationConfig();
  if (homologation.enabled && homologation.conventionId) {
    const rows = Array.isArray(result.data.data) ? [...result.data.data] : [];
    if (!rows.some((item) => item.convenio_id === homologation.conventionId)) {
      rows.unshift({
        convenio_id: homologation.conventionId,
        nombre: `Homologación MisRX (ID ${homologation.conventionId})`,
        autorizado: 1,
      });
    }

    return NextResponse.json({
      ...result.data,
      total: Math.max(result.data.total ?? 0, rows.length),
      data: rows,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
