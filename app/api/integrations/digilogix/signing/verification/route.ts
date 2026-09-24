import { NextRequest, NextResponse } from 'next/server';

import {
  getDigilogixCertificate,
  verifyDigilogixSignedHash,
} from '@/lib/digilogix/certificates';
import {
  isFullySigned,
  signedPdfBuffer,
} from '@/lib/digilogix/response';
import { getDocumentSignatureState } from '@/lib/digilogix/signing';
import { isValidCuil } from '@/lib/digilogix/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function describeShape(value: unknown, depth = 0): unknown {
  if (depth >= 3) {
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    return { type: value === null ? 'null' : typeof value };
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, firstItem: value.length ? describeShape(value[0], depth + 1) : null };
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return {
      type: 'object',
      keys: Object.keys(obj),
      fields: Object.fromEntries(Object.entries(obj).map(([key, v]) => [key, describeShape(v, depth + 1)])),
    };
  }
  return { type: value === null ? 'null' : typeof value };
}

type VerificationContext = {
  documentId: string;
  sourceHash: string;
};

function readVerificationContext(request: NextRequest): VerificationContext | null {
  const raw = request.cookies.get('digilogix_preview_verification')?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<VerificationContext>;
    if (
      typeof parsed.documentId !== 'string'
      || !parsed.documentId.trim()
      || typeof parsed.sourceHash !== 'string'
      || !/^[a-fA-F0-9]{64}$/.test(parsed.sourceHash)
    ) {
      return null;
    }

    return {
      documentId: parsed.documentId.trim(),
      sourceHash: parsed.sourceHash.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return new NextResponse(null, { status: 404 });
  }

  const context = readVerificationContext(request);
  if (!context) {
    return NextResponse.json(
      { ok: false, stage: 'verification_context', reason: 'missing_or_invalid_context' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const stateResult = await getDocumentSignatureState(context.documentId);
  if (!stateResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'state_transport',
        reason: stateResult.reason,
        status: stateResult.status ?? null,
        message: stateResult.errorMessage,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const state = stateResult.data;
  if (state.CodigoResultado !== 1 || !state.Datos) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'state_provider',
        codigoResultado: state.CodigoResultado,
        mensajeResultado: state.MensajeResultado,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!isFullySigned(state)) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'signature_pending',
        codigoEstado: state.Datos.CodigoEstado,
        descripcionEstado: state.Datos.DescripcionEstado,
        signerStates: Array.isArray(state.Datos.Estados)
          ? state.Datos.Estados.map((item) => ({
              codigoEstado: item.CodigoEstado,
              descripcionEstado: item.DescripcionEstado,
            }))
          : [],
      },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const signedPdf = signedPdfBuffer(state);
  if (!signedPdf) {
    return NextResponse.json(
      { ok: false, stage: 'signed_pdf', reason: 'missing_signed_pdf' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (
    signedPdf.length > 10 * 1024 * 1024
    || signedPdf.subarray(0, 5).toString('ascii') !== '%PDF-'
  ) {
    return NextResponse.json(
      { ok: false, stage: 'signed_pdf', reason: 'invalid_signed_pdf' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const signedHash = state.Datos.HashSHA256FirmadoHexadecimal?.trim();
  const pdfBinary = signedPdf.toString('latin1');
  const embeddedSignatureStructurePresent =
    pdfBinary.includes('/ByteRange')
    && pdfBinary.includes('/Contents');

  const cuil = process.env.DIGILOGIX_TEST_CUIL?.trim();
  if (!cuil || !isValidCuil(cuil)) {
    return NextResponse.json(
      { ok: false, stage: 'configuration', reason: 'test_cuil_invalid_or_missing' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const certificateResult = await getDigilogixCertificate({
    CodigoUnicoIdentificacion: cuil,
  });

  if (!certificateResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'certificate_transport',
        reason: certificateResult.reason,
        status: certificateResult.status ?? null,
        message: certificateResult.errorMessage,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const certificate = certificateResult.data.Datos?.CertificadoDerBase64;
  if (certificateResult.data.CodigoResultado !== 1 || !certificate) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'certificate_provider',
        codigoResultado: certificateResult.data.CodigoResultado,
        mensajeResultado: certificateResult.data.MensajeResultado,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!signedHash) {
    const response = NextResponse.json(
      {
        ok: true,
        stage: 'signed_pdf_received_hash_unavailable',
        documentState: state.Datos.CodigoEstado,
        documentStateDescription: state.Datos.DescripcionEstado,
        signedPdfValid: true,
        signedPdfBytes: signedPdf.length,
        embeddedSignatureStructurePresent,
        signedHashPresent: false,
        certificateAvailable: true,
        cryptographicHashVerification: 'not_available_from_provider_response',
        verificationLevel: 'provider_reports_signed_pdf_received_not_independently_verified',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    response.cookies.delete('digilogix_preview_verification');
    return response;
  }

  const verificationResult = await verifyDigilogixSignedHash({
    CertificadoBase64: certificate,
    HashSHA256Hexadecimal: context.sourceHash,
    HashSHA256FirmadoHexadecimal: signedHash,
  });

  if (!verificationResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'hash_verification_transport',
        reason: verificationResult.reason,
        status: verificationResult.status ?? null,
        message: verificationResult.errorMessage,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (verificationResult.data.CodigoResultado !== 1) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'hash_verification_provider',
        codigoResultado: verificationResult.data.CodigoResultado,
        mensajeResultado: verificationResult.data.MensajeResultado,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const response = NextResponse.json(
    {
      ok: true,
      stage: 'verified',
      documentState: state.Datos.CodigoEstado,
      documentStateDescription: state.Datos.DescripcionEstado,
      signedPdfValid: true,
      signedPdfBytes: signedPdf.length,
      signedHashPresent: true,
      certificateAvailable: true,
      embeddedSignatureStructurePresent,
      hashVerification: 'valid',
      verificationLevel: 'provider_hash_verified',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );

  response.cookies.delete('digilogix_preview_verification');
  return response;
}
