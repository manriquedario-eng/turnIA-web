// Callback de Mercado Pago OAuth. Valida `state` (CSRF) y `code_verifier`
// (PKCE) contra las cookies seteadas en
// /api/integrations/mercadopago/oauth/connect, exige sesión válida
// (requireTenant), intercambia el code por tokens server-side y los guarda.
// Nunca expone tokens en la respuesta ni en la URL de redirect: siempre
// redirige a /settings con, a lo sumo, un mensaje de ok/error en texto
// plano. Mismo patrón que app/api/google/oauth/callback/route.ts.

import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireTenant } from '@/lib/auth/require-user';
import { completeMercadoPagoOAuthConnection } from '@/lib/mercadopago/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'turnia_mp_oauth_state';
const VERIFIER_COOKIE = 'turnia_mp_oauth_verifier';

export async function GET(request: NextRequest) {
  const { tenantId, user } = await requireTenant();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const mpError = searchParams.get('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const expectedVerifier = cookieStore.get(VERIFIER_COOKIE)?.value;
  // Cookies de un solo uso: se borran SIEMPRE, se procesen bien o no.
  cookieStore.delete(STATE_COOKIE);
  cookieStore.delete(VERIFIER_COOKIE);

  if (mpError) {
    // El profesional canceló el consentimiento u otro error de Mercado
    // Pago. No es un fallo de la app: no se loguea como error, se informa
    // sin más. Nunca se loguea el valor de `mpError` tal cual (podría, en
    // teoría, venir manipulado en la query string).
    return NextResponse.redirect(new URL('/settings?error=Conexi%C3%B3n%20con%20Mercado%20Pago%20cancelada#integraciones', request.url));
  }

  // Diagnóstico temporal: sólo booleanos derivados, nunca los valores
  // reales de code/state/verifier (no se loguean secretos ni cookies).
  console.warn('Mercado Pago OAuth callback diagnostic', {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasExpectedState: Boolean(expectedState),
    hasExpectedVerifier: Boolean(expectedVerifier),
    stateMatches: Boolean(state && expectedState && state === expectedState),
  });

  if (!code || !state || !expectedState || !expectedVerifier || state !== expectedState) {
    // Sanitizado: nunca se loguea code/state/verifier, sólo que faltó algo.
    console.warn('Mercado Pago OAuth callback: state/verifier inválido o code ausente');
    return NextResponse.redirect(
      new URL('/settings?error=No%20se%20pudo%20validar%20la%20conexi%C3%B3n%20con%20Mercado%20Pago#integraciones', request.url)
    );
  }

  const result = await completeMercadoPagoOAuthConnection({
    tenantId,
    userId: user.id,
    code,
    codeVerifier: expectedVerifier,
  });

  if (!result.ok) {
    // Sanitizado: nunca el code, el verifier, ni tokens — sólo un mensaje
    // de error ya acotado por completeMercadoPagoOAuthConnection.
    console.error('Mercado Pago OAuth callback: no se pudo completar la conexión', result.errorMessage);
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(result.errorMessage)}#integraciones`, request.url));
  }

  return NextResponse.redirect(new URL('/settings?ok=Mercado%20Pago%20conectado#integraciones', request.url));
}
