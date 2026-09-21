import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';

export async function GET(request: NextRequest) {
  const { tenantId, user } = await requireTenant();
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ error: 'La búsqueda debe tener entre 2 y 100 caracteres.' }, { status: 400 });
  }

  const limit = await checkRateLimit({
    scope: 'misrx-diagnoses-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 60,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas. Intentá nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const rawValue = request.nextUrl.searchParams.get('valor');
  const value = rawValue && /^\d+$/.test(rawValue) ? Number(rawValue) : undefined;

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const result = await adapterResult.data.searchDiagnoses({ query, value });

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
