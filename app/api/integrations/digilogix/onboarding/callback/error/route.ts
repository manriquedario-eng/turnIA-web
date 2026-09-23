import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return NextResponse.redirect(
    new URL('/settings?error=' + encodeURIComponent('Digilogix informó un error durante el alta de firma digital.') + '#integraciones', request.url),
  );
}
