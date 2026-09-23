import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  // El redirect OK NO prueba que el certificado esté activo. Sólo informa
  // que el navegador volvió por el camino declarado como exitoso.
  return NextResponse.redirect(
    new URL('/settings?ok=' + encodeURIComponent('Digilogix devolvió el proceso de alta como completado. Falta verificar el estado con el proveedor.') + '#integraciones', request.url),
  );
}
