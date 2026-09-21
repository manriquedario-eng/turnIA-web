import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export async function GET() {
  await requireTenant();

  return NextResponse.json({
    provider: 'misrx',
    phase: 'foundation',
    available: true,
    liveIssuingEnabled: false,
    message: 'La estructura de MisRX está instalada. La emisión real permanece deshabilitada hasta configurar credenciales y AppID.',
  });
}
