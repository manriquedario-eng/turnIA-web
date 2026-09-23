import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  // Nunca marcar un documento como firmado por este redirect. La fuente de
  // verdad será PostObtenerEstadoFirmaDigitalDocumento + verificación.
  return NextResponse.redirect(
    new URL('/patients?ok=' + encodeURIComponent('La autorización de firma volvió desde Digilogix. TurnIA debe verificar el estado antes de marcar el documento como firmado.'), request.url),
  );
}
