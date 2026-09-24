import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireTenant } from '@/lib/auth/require-user';
import { getDigilogixCertificate, verifyDigilogixSignedHash } from '@/lib/digilogix/certificates';
import { getDigilogixConnection } from '@/lib/digilogix/connection';
import { isFullySigned, signedPdfBuffer } from '@/lib/digilogix/response';
import { getDocumentSignatureState } from '@/lib/digilogix/signing';
import { findDocumentForProviderCallback } from '@/lib/documents/authorize';
import { sha256Hex } from '@/lib/documents/hash';
import { buildSignedStoragePath } from '@/lib/documents/paths';
import { downloadDocumentPdf, removeDocumentObjectBestEffort, uploadProviderSignedPdf } from '@/lib/documents/storage';
import { isPdfMagicBytes, isWithinMaxSignedSize } from '@/lib/documents/validation';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompleteProviderSignatureRpcResult = {
  ok: boolean;
  reason: string | null;
};

function patientUrl(request: NextRequest, patientId: string, key: 'success' | 'error', message: string) {
  return new URL(`/patients/${patientId}?${key}=${encodeURIComponent(message)}#documentos`, request.url);
}

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

  if (!document?.provider_document_id) {
    return NextResponse.redirect(
      patientUrl(request, patientCheck.data, 'error', 'No encontramos una firma Digilogix pendiente para este documento.'),
    );
  }

  const stateResult = await getDocumentSignatureState(document.provider_document_id);
  if (!stateResult.ok || stateResult.data.CodigoResultado !== 1 || !stateResult.data.Datos) {
    return NextResponse.redirect(
      patientUrl(request, patientCheck.data, 'error', 'No pudimos verificar el estado de la firma con Digilogix.'),
    );
  }

  if (!isFullySigned(stateResult.data)) {
    return NextResponse.redirect(
      patientUrl(
        request,
        patientCheck.data,
        'error',
        `La firma todavía no está completa: ${stateResult.data.Datos.DescripcionEstado || 'estado pendiente'}.`,
      ),
    );
  }

  const signedPdf = signedPdfBuffer(stateResult.data);
  if (!signedPdf || !isWithinMaxSignedSize(signedPdf.byteLength) || !isPdfMagicBytes(signedPdf)) {
    return NextResponse.redirect(
      patientUrl(request, patientCheck.data, 'error', 'Digilogix no devolvió un PDF firmado válido.'),
    );
  }

  const connection = await getDigilogixConnection(supabase, tenantId, user.id);
  if (!connection || connection.status !== 'connected') {
    return NextResponse.redirect(
      patientUrl(request, patientCheck.data, 'error', 'La conexión de firma digital ya no está activa.'),
    );
  }

  const providerSignedHash = stateResult.data.Datos.HashSHA256FirmadoHexadecimal?.trim();
  let hashVerification: 'verified' | 'unavailable' = 'unavailable';

  if (providerSignedHash) {
    const certificateResult = await getDigilogixCertificate({
      CodigoUnicoIdentificacion: connection.cuil,
    });

    const certificate = certificateResult.ok
      ? certificateResult.data.Datos?.CertificadoDerBase64
      : null;

    if (!certificate) {
      return NextResponse.redirect(
        patientUrl(request, patientCheck.data, 'error', 'No pudimos obtener el certificado para validar la firma.'),
      );
    }

    const originalPdf = await downloadDocumentPdf(document.original_storage_path);
    if (!originalPdf || !isWithinMaxSignedSize(originalPdf.byteLength) || !isPdfMagicBytes(originalPdf)) {
      return NextResponse.redirect(
        patientUrl(request, patientCheck.data, 'error', 'No pudimos recuperar el PDF original para validar la firma.'),
      );
    }

    const verification = await verifyDigilogixSignedHash({
      CertificadoBase64: certificate,
      HashSHA256Hexadecimal: sha256Hex(originalPdf),
      HashSHA256FirmadoHexadecimal: providerSignedHash,
    });

    if (!verification.ok || verification.data.CodigoResultado !== 1) {
      return NextResponse.redirect(
        patientUrl(request, patientCheck.data, 'error', 'La verificación criptográfica informada por Digilogix no fue válida.'),
      );
    }
    hashVerification = 'verified';
  }

  const uploadUuid = randomUUID();
  const signedPath = buildSignedStoragePath(tenantId, patientCheck.data, documentCheck.data, uploadUuid);
  const upload = await uploadProviderSignedPdf(signedPath, signedPdf);
  if (!upload.ok) {
    return NextResponse.redirect(
      patientUrl(request, patientCheck.data, 'error', 'No pudimos guardar el PDF firmado.'),
    );
  }

  const service = createSupabaseServiceClient();
  const { data: rpcData, error: rpcError } = await service
    .rpc('complete_provider_patient_document_signature_server', {
      p_tenant_id: tenantId,
      p_actor_user_id: user.id,
      p_document_id: documentCheck.data,
      p_signed_storage_path: signedPath,
      p_signed_sha256: sha256Hex(signedPdf),
      p_signed_bytes: signedPdf.byteLength,
      p_provider_state_code: stateResult.data.Datos.CodigoEstado,
      p_provider_state_description: stateResult.data.Datos.DescripcionEstado,
      p_provider_hash_verification: hashVerification,
    })
    .single()
    .returns<CompleteProviderSignatureRpcResult>();

  if (rpcError || !rpcData?.ok) {
    await removeDocumentObjectBestEffort(
      signedPath,
      `Digilogix callback completion — document ${documentCheck.data}`,
    );
    return NextResponse.redirect(
      patientUrl(request, patientCheck.data, 'error', 'No pudimos registrar el documento firmado.'),
    );
  }

  return NextResponse.redirect(
    patientUrl(request, patientCheck.data, 'success', 'Documento firmado con Digilogix y guardado en TurnIA.'),
  );
}
