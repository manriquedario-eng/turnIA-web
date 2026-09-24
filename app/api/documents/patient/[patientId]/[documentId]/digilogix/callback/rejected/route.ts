import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireTenant } from '@/lib/auth/require-user';
import { findDocumentForProviderCallback } from '@/lib/documents/authorize';
import { getDocumentSignatureState } from '@/lib/digilogix/signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RejectRpcResult = { ok: boolean; reason: string | null };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string; documentId: string }> },
) {
  const { supabase, user, tenantId } = await requireTenant();
  const { patientId, documentId } = await params;

  const patientCheck = z.string().uuid().safeParse(patientId);
  const documentCheck = z.string().uuid().safeParse(documentId);
  if (!patientCheck.success || !documentCheck.success) {
    return NextResponse.redirect(new URL('/patients?error=Documento%20inv%C3%A1lido', request.url));
  }

  const document = await findDocumentForProviderCallback(
    supabase,
    tenantId,
    patientCheck.data,
    documentCheck.data,
    user.id,
  );

  if (document?.provider_document_id) {
    const state = await getDocumentSignatureState(document.provider_document_id);
    const providerState = state.ok && state.data.CodigoResultado === 1 ? state.data.Datos : null;

    await supabase
      .rpc('mark_provider_patient_document_rejected', {
        p_document_id: documentCheck.data,
        p_provider_state_code: providerState?.CodigoEstado ?? 0,
        p_provider_state_description: providerState?.DescripcionEstado ?? 'Firma rechazada o cancelada',
      })
      .single()
      .returns<RejectRpcResult>();
  }

  return NextResponse.redirect(
    new URL(
      `/patients/${patientCheck.data}?error=${encodeURIComponent('La firma fue rechazada o cancelada. Podés volver a intentarla desde Documentos.')}#documentos`,
      request.url,
    ),
  );
}
