import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string; documentId: string }> },
) {
  const { patientId } = await params;
  const patientCheck = z.string().uuid().safeParse(patientId);
  if (!patientCheck.success) {
    return NextResponse.redirect(new URL('/patients?error=Documento%20inv%C3%A1lido', request.url));
  }

  return NextResponse.redirect(
    new URL(
      `/patients/${patientCheck.data}?error=${encodeURIComponent('Digilogix informó un error durante la firma. El documento no fue marcado como firmado.')}#documentos`,
      request.url,
    ),
  );
}
