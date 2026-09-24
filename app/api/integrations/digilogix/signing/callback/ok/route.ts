import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  // El callback OK solo confirma que Digilogix devolvió el control.
  // La verificación real se realiza en una ruta separada que consulta
  // el estado del documento y valida criptográficamente la firma.
  return NextResponse.redirect(
    new URL('/api/integrations/digilogix/signing/verification', request.url),
  );
}
