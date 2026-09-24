import { NextResponse } from 'next/server';

import { areDigilogixLiveCallsEnabled, getDigilogixConfig } from '@/lib/digilogix/config';
import { firstAuthorizationUrl, firstUploadedDocument } from '@/lib/digilogix/response';
import { requestSinglePdfSignature } from '@/lib/digilogix/service';
import { isValidCuil } from '@/lib/digilogix/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildMinimalPdf(): Buffer {
  const header = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 120 >>\nstream\nBT\n/F1 18 Tf\n72 760 Td\n(TurnIA - Prueba controlada de firma digital) Tj\n0 -30 Td\n/F1 11 Tf\n(Documento de homologacion Digilogix. Sin valor clinico.) Tj\nET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(header + body, 'latin1'));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(header + body, 'latin1');
  const xref = [
    'xref\n',
    '0 6\n',
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
  ].join('');

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(header + body + xref + trailer, 'latin1');
}

function describeShape(value: unknown, depth = 0): unknown {
  if (depth >= 4) {
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    return { type: value === null ? 'null' : typeof value };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      firstItem: value.length ? describeShape(value[0], depth + 1) : null,
    };
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return {
      type: 'object',
      keys: Object.keys(obj),
      fields: Object.fromEntries(
        Object.entries(obj).map(([key, fieldValue]) => [key, describeShape(fieldValue, depth + 1)]),
      ),
    };
  }

  return { type: value === null ? 'null' : typeof value };
}

/**
 * Homologación temporal de firma digital.
 * - Solo funciona en Vercel Preview.
 * - Requiere ?confirm=1 para evitar solicitudes accidentales.
 * - Usa exclusivamente DIGILOGIX_TEST_CUIL.
 * - Genera un PDF mínimo sin datos clínicos ni personales.
 * - No persiste PIN, OTP ni secretos.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('confirm') !== '1') {
    return NextResponse.json(
      {
        ok: false,
        stage: 'confirmation',
        reason: 'confirmation_required',
        next: '?confirm=1',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const config = getDigilogixConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, stage: 'configuration', reason: 'not_configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!config.companyId) {
    return NextResponse.json(
      { ok: false, stage: 'configuration', reason: 'company_id_not_configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!areDigilogixLiveCallsEnabled()) {
    return NextResponse.json(
      { ok: false, stage: 'configuration', reason: 'live_calls_disabled' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const cuil = process.env.DIGILOGIX_TEST_CUIL?.trim();
  if (!cuil || !isValidCuil(cuil)) {
    return NextResponse.json(
      { ok: false, stage: 'configuration', reason: 'test_cuil_invalid_or_missing' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const pdf = buildMinimalPdf();
  if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return NextResponse.json(
      { ok: false, stage: 'document', reason: 'generated_pdf_invalid' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await requestSinglePdfSignature({
    pdf,
    cuil,
    reason: 'Prueba controlada de firma digital TurnIA',
    showDocumentWhenAuthorizing: true,
    visibleSignatureTemplate: 1,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'transport',
        reason: result.reason,
        status: result.status ?? null,
        message: result.errorMessage,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const document = firstUploadedDocument(result.data);
  const authorizationUrl = firstAuthorizationUrl(result.data);

  if (!document || !authorizationUrl) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'provider_response',
        httpStatus: result.status,
        codigoResultado: result.data.CodigoResultado,
        mensajeResultado: result.data.MensajeResultado,
        reason: 'missing_document_or_authorization_url',
        providerShape: describeShape(result.data),
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      stage: 'authorization_required',
      httpStatus: result.status,
      codigoResultado: result.data.CodigoResultado,
      mensajeResultado: result.data.MensajeResultado,
      identificadorDocumento: document.IdentificadorDocumento,
      hashSHA256Hexadecimal: document.HashSHA256Hexadecimal,
      authorizationUrl,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
