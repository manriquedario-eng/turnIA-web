import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return NextResponse.redirect(
    new URL('/patients?error=' + encodeURIComponent('Digilogix informó un error durante la firma digital.'), request.url),
  );
}
