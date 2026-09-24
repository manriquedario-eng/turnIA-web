import { NextResponse } from 'next/server';

import { requireTenant } from '@/lib/auth/require-user';
import { connectOrRefreshDigilogix, getDigilogixConnection } from '@/lib/digilogix/connection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { supabase, user, tenantId } = await requireTenant();
  const connection = await getDigilogixConnection(supabase, tenantId, user.id);

  if (!connection) {
    return NextResponse.redirect(
      new URL('/settings?error=' + encodeURIComponent('No encontramos una configuración de firma digital para verificar.') + '#integraciones', request.url),
    );
  }

  const result = await connectOrRefreshDigilogix({
    supabase,
    tenantId,
    userId: user.id,
    cuil: connection.cuil,
    email: connection.email,
    beginOnboardingWhenNeeded: false,
  });

  if (!result.ok || result.status !== 'connected') {
    return NextResponse.redirect(
      new URL('/settings?error=' + encodeURIComponent('Digilogix devolvió el alta, pero el certificado todavía no figura disponible. Usá “Verificar conexión” cuando termine de emitirse.') + '#integraciones', request.url),
    );
  }

  return NextResponse.redirect(
    new URL('/settings?ok=' + encodeURIComponent('Firma digital Digilogix conectada y certificado vigente.') + '#integraciones', request.url),
  );
}
