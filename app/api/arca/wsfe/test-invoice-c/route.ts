import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { issueWsfeTestInvoiceC } from '@/lib/arca/wsfe';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { user, tenantId } = await requireTenant();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud inválida.' }, { status: 400 });
  }

  const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (input.confirm !== true) {
    return NextResponse.json(
      { ok: false, error: 'Tenés que confirmar expresamente la emisión de prueba en homologación.' },
      { status: 400 },
    );
  }

  const result = await issueWsfeTestInvoiceC({
    tenantId,
    userId: user.id,
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
