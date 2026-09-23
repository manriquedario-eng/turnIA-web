import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return NextResponse.redirect(
    new URL('/patients?error=' + encodeURIComponent('La firma digital fue rechazada o cancelada.'), request.url),
  );
}
