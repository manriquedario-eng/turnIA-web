// Inicia el flujo de Mercado Pago OAuth (Authorization Code + PKCE) para EL
// PROFESIONAL logueado (no una cuenta compartida de tenant). GET porque se
// llega acá desde un link normal en Settings, nunca desde un fetch/XHR.
// Mismo patrón que app/api/google/oauth/connect/route.ts.
//
// Flujo: requireTenant() exige sesión válida -> se verifica que el request
// corre bajo el host canónico de producción (ver más abajo) -> se genera un
// `state` aleatorio (CSRF) y un par PKCE (code_verifier/code_challenge) ->
// state y code_verifier se guardan en DOS cookies httpOnly separadas de
// corta vida -> se redirige a Mercado Pago. El callback valida ambos antes
// de intercambiar el `code`.

import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { requireTenant } from '@/lib/auth/require-user';
import { buildMercadoPagoAuthUrl, generateMercadoPagoPkcePair, isMercadoPagoOAuthConfigured } from '@/lib/mercadopago/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'turnia_mp_oauth_state';
const VERIFIER_COOKIE = 'turnia_mp_oauth_verifier';

// MP_REDIRECT_URI está fijo al dominio productivo
// (https://www.turniahealth.com.ar/...). El `state` y el `code_verifier`
// viven en cookies del dominio que INICIA el flujo — si alguien arranca
// desde un deployment Preview de *.vercel.app, esas cookies quedan en el
// dominio del preview, pero Mercado Pago va a redirigir siempre al callback
// de producción (el host fijo de MP_REDIRECT_URI), donde esas cookies no
// existen. En vez de dejar que eso falle de forma confusa en el callback,
// se corta acá: si el request no corre bajo el host canónico, no se inicia
// nada de OAuth (nunca se generan cookies, nunca se llama a Mercado Pago).
const MP_CANONICAL_HOST = 'www.turniahealth.com.ar';

export async function GET(request: NextRequest) {
  // Exige sesión + tenant, igual que cualquier página de /(protected)/.
  await requireTenant();

  if (request.nextUrl.hostname !== MP_CANONICAL_HOST) {
    return NextResponse.redirect(
      new URL(
        `/settings?error=${encodeURIComponent('La conexión con Mercado Pago debe realizarse desde la versión de producción de TurnIA.')}#integraciones`,
        request.url
      )
    );
  }

  if (!isMercadoPagoOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(
        `/settings?error=${encodeURIComponent('Conexión con Mercado Pago no configurada en el servidor todavía')}#integraciones`,
        request.url
      )
    );
  }

  const state = randomBytes(24).toString('hex');
  const { codeVerifier, codeChallenge } = generateMercadoPagoPkcePair();
  const authUrlResult = buildMercadoPagoAuthUrl(state, codeChallenge);

  if (!authUrlResult.ok) {
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent('No se pudo iniciar la conexión con Mercado Pago')}#integraciones`, request.url)
    );
  }

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: 600, // 10 minutos: tiempo de sobra para completar el consentimiento
    path: '/',
  };
  // Cookies SEPARADAS a propósito (nunca un solo valor combinado): state es
  // el anti-CSRF de siempre, code_verifier es el secreto PKCE — mezclarlos
  // no aporta nada y complica poder invalidar/leer cada uno por separado.
  cookieStore.set(STATE_COOKIE, state, cookieOptions);
  cookieStore.set(VERIFIER_COOKIE, codeVerifier, cookieOptions);

  return NextResponse.redirect(authUrlResult.data);
}
