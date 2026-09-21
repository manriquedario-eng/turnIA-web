import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { getWsfeLastAuthorized } from '@/lib/arca/wsfe';

export const dynamic = 'force-dynamic';

function readPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function POST(request: Request) {
  const { user, tenantId } = await requireTenant();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud inválida.' }, { status: 400 });
  }

  const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const pointOfSale = readPositiveInteger(input.pointOfSale);
  const voucherType = readPositiveInteger(input.voucherType);

  if (!pointOfSale || !voucherType) {
    return NextResponse.json(
      { ok: false, error: 'Punto de venta y tipo de comprobante deben ser números enteros positivos.' },
      { status: 400 },
    );
  }

  const result = await getWsfeLastAuthorized({
    tenantId,
    userId: user.id,
    pointOfSale,
    voucherType,
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
