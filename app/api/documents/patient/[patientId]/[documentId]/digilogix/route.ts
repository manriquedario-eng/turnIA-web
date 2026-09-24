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

  const escapedAuthorizationUrl = authorizationUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta http-equiv="refresh" content="1;url=${escapedAuthorizationUrl}" />
    <title>Abriendo Digilogix…</title>
    <style>
      body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f8fa;color:#172033}
      main{max-width:560px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
      h1{font-size:22px;margin:0 0 10px}
      p{line-height:1.5;color:#556070}
      a{display:inline-block;margin-top:14px;padding:10px 16px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-weight:600}
    </style>
  </head>
  <body>
    <main>
      <h1>Abriendo Digilogix…</h1>
      <p>La firma ya fue iniciada en TurnIA. Te estamos llevando al entorno seguro de Digilogix para autorizarla.</p>
      <p>Si no se abre automáticamente, usá el botón de abajo.</p>
      <a href="${escapedAuthorizationUrl}">Continuar en Digilogix</a>
    </main>
    <script>window.location.replace(${JSON.stringify(authorizationUrl)});</script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
