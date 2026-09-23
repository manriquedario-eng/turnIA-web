import { NextResponse } from 'next/server';

import { areDigilogixLiveCallsEnabled } from '@/lib/digilogix/config';
import { commonResultMeaning } from '@/lib/digilogix/response';
import { startProfessionalDigilogixOnboarding } from '@/lib/digilogix/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnóstico temporal de onboarding de homologación.
 * - Solo funciona en Vercel Preview.
 * - Requiere confirm=1 para evitar disparos accidentales.
 * - Lee el email desde DIGILOGIX_TEST_EMAIL.
 * - No devuelve el email ni secretos.
 * - No usa PIN ni OTP.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return new NextResponse(null, { status: 404 });
  }

  if (!areDigilogixLiveCallsEnabled()) {
    return NextResponse.json(
      { ok: false, stage: 'configuration', reason: 'live_calls_disabled' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const url = new URL(request.url);
  if (url.searchParams.get('confirm') !== '1') {
    return NextResponse.json(
      {
        ok: false,
        stage: 'confirmation',
        reason: 'confirmation_required',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const email = process.env.DIGILOGIX_TEST_EMAIL?.trim();
  if (!email) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        reason: 'test_email_not_configured',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await startProfessionalDigilogixOnboarding({
    email,
    showPaymentStep: false,
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

  return NextResponse.json(
    {
      ok: true,
      stage: 'provider_response',
      httpStatus: result.status,
      codigoResultado: result.data.CodigoResultado,
      significado: commonResultMeaning(result.data.CodigoResultado),
      mensajeResultado: result.data.MensajeResultado,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
