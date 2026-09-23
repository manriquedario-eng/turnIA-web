import { NextResponse } from 'next/server';

import { getDigilogixCertificate } from '@/lib/digilogix/certificates';
import {
  areDigilogixLiveCallsEnabled,
  getDigilogixConfig,
} from '@/lib/digilogix/config';
import { certificateResultMeaning } from '@/lib/digilogix/response';
import { isValidCuil } from '@/lib/digilogix/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnóstico temporal de homologación.
 * - Solo existe funcionalmente en Vercel Preview.
 * - Lee el CUIL de homologación desde DIGILOGIX_TEST_CUIL.
 * - Nunca recibe el CUIL por URL ni lo devuelve en la respuesta.
 * - Nunca devuelve secretos, token de Authorization ni headers sensibles.
 * - No requiere EmpresaID.
 */
export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return new NextResponse(null, { status: 404 });
  }

  const config = getDigilogixConfig();

  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        reason: 'not_configured',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!areDigilogixLiveCallsEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        reason: 'live_calls_disabled',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const testCuil = process.env.DIGILOGIX_TEST_CUIL?.trim();

  if (!testCuil) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        reason: 'test_cuil_not_configured',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!isValidCuil(testCuil)) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        reason: 'test_cuil_invalid',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await getDigilogixCertificate({
    CodigoUnicoIdentificacion: testCuil,
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

  const provider = result.data;

  return NextResponse.json(
    {
      ok: true,
      stage: 'provider_response',
      httpStatus: result.status,
      codigoResultado: provider.CodigoResultado,
      significado: certificateResultMeaning(provider.CodigoResultado),
      mensajeResultado: provider.MensajeResultado,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
