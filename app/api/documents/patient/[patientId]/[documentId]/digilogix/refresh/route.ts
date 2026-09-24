import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireTenant } from '@/lib/auth/require-user';
import { findDocumentForProviderCallback } from '@/lib/documents/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string; documentId: string }> },
) {
  const { supabase, user, tenantId } = await requireTenant();
  const { patientId, documentId } = await params;

  const patientCheck = z.string().uuid().safeParse(patientId);
  const documentCheck = z.string().uuid().safeParse(documentId);
  if (!patientCheck.success || !documentCheck.success) {
    return NextResponse.redirect(new URL('/patients?error=Documento%20inv%C3%A1lido', request.url), 303);
  }

  const document = await findDocumentForProviderCallback(
    supabase,
    tenantId,
    patientCheck.data,
    documentCheck.data,
    user.id,
  );

  if (!document?.provider_document_id) {
    return NextResponse.redirect(
      new URL(
        `/patients/${patientCheck.data}?error=${encodeURIComponent('No encontramos una firma Digilogix pendiente para verificar.')}#documentos`,
        request.url,
      ),
      303,
    );
  }

  return NextResponse.redirect(
    new URL(
      `/api/documents/patient/${patientCheck.data}/${documentCheck.data}/digilogix/callback/ok`,
      request.url,
    ),
    303,
  );
}
