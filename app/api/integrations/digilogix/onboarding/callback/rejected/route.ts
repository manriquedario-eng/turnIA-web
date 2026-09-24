import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return NextResponse.redirect(
    new URL('/settings?error=' + encodeURIComponent('El proceso de alta de firma digital fue rechazado o cancelado.') + '#integraciones', request.url),
  );
}
