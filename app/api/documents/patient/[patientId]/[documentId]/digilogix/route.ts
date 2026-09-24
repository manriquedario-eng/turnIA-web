import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireTenant } from '@/lib/auth/require-user';
import { getDigilogixConnection } from '@/lib/digilogix/connection';
import { firstAuthorizationUrl, firstUploadedDocument } from '@/lib/digilogix/response';
import { requestSinglePdfSignature } from '@/lib/digilogix/service';
import { findDocumentForProviderCallback, findDocumentForProviderSignature } from '@/lib/documents/authorize';
import { documentErrorResponse } from '@/lib/documents/response';
import { downloadDocumentPdf } from '@/lib/documents/storage';
import { isPdfMagicBytes, isWithinMaxSignedSize } from '@/lib/documents/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StartProviderSignatureRpcResult = {
  ok: boolean;
  reason: string | null;
};

function callbackUrls(request: NextRequest, patientId: string, documentId: string) {
  const base = new URL(request.url);
  const root = base.origin;
  const prefix = `${root}/api/documents/patient/${patientId}/${documentId}/digilogix/callback`;
  return {
    ok: `${prefix}/ok`,
    error: `${prefix}/error`,
    rejected: `${prefix}/rejected`,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string; documentId: string }> },
) {
  const { supabase, user, tenantId } = await requireTenant();
  const { patientId, documentId } = await params;

  const patientCheck = z.string().uuid().safeParse(patientId);
  const documentCheck = z.string().uuid().safeParse(documentId);
  if (!patientCheck.success || !documentCheck.success) {
    return documentErrorResponse('Documento no encontrado.', 404);
  }

  const connection = await getDigilogixConnection(supabase, tenantId, user.id);
  if (!connection || connection.status !== 'connected') {
    return NextResponse.json(
      { error: 'Conectá primero tu firma digital desde Configuración → Integraciones.' },
      { status: 409 },
    );
  }

  const document = await findDocumentForProviderSignature(
    supabase,
    tenantId,
    patientCheck.data,
    documentCheck.data,
    user.id,
  );
  if (!document) {
    const pendingDocument = await findDocumentForProviderCallback(
      supabase,
      tenantId,
      patientCheck.data,
      documentCheck.data,
      user.id,
    );

    if (pendingDocument) {
      return NextResponse.redirect(
        new URL(
          `/patients/${patientCheck.data}?success=${encodeURIComponent('La firma con Digilogix ya está en curso. Usá “Verificar estado”.')}#documentos`,
          request.url,
        ),
        { status: 303 },
      );
    }

    return documentErrorResponse('Documento no disponible para firma digital.', 404);
  }

  const pdf = await downloadDocumentPdf(document.original_storage_path);
  if (!pdf || !isWithinMaxSignedSize(pdf.byteLength) || !isPdfMagicBytes(pdf)) {
    return documentErrorResponse('El PDF original no está disponible o no es válido.', 422);
  }

  const providerResult = await requestSinglePdfSignature({
    pdf,
    cuil: connection.cuil,
    reason: 'Firma digital de documento clínico en TurnIA',
    showDocumentWhenAuthorizing: true,
    visibleSignatureTemplate: 1,
    returnUrls: callbackUrls(request, patientCheck.data, documentCheck.data),
  });

  if (!providerResult.ok) {
    return NextResponse.json(
      { error: 'Digilogix no pudo iniciar la firma. Intentá nuevamente.' },
      { status: 502 },
    );
  }

  const providerDocument = firstUploadedDocument(providerResult.data);
  const authorizationUrl = firstAuthorizationUrl(providerResult.data);
  if (!providerDocument || !authorizationUrl) {
    return NextResponse.json(
      { error: 'Digilogix no devolvió una autorización de firma válida.' },
      { status: 502 },
    );
  }

  const { data: rpcData, error: rpcError } = await supabase
    .rpc('start_provider_patient_document_signature', {
      p_document_id: documentCheck.data,
      p_provider: 'digilogix',
      p_provider_document_id: providerDocument.IdentificadorDocumento,
    })
    .single()
    .returns<StartProviderSignatureRpcResult>();

  if (rpcError || !rpcData?.ok) {
    return NextResponse.json(
      { error: 'No pudimos registrar el inicio de la firma. Intentá nuevamente.' },
      { status: 409 },
    );
  }

  return NextResponse.redirect(authorizationUrl, { status: 303 });
}
