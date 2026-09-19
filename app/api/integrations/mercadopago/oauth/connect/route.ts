// Inicia el flujo de Mercado Pago OAuth (Authorization Code + PKCE) para EL
// PROFESIONAL logueado (no una cuenta compartida de tenant). GET porque se
// llega acá desde un link normal en Settings, nunca desde un fetch/XHR.
// Mismo patrón que app/api/google/oauth/connect/route.ts.
//
// Flujo: requireTenant() exige sesión válida -> si el host público es el
// apex sin www, se redirige a www ANTES de generar nada -> se verifica que
// el environment de Vercel sea 'production' (ver isProductionEnvironment
// más abajo) -> se genera un `state` aleatorio (CSRF) y un par PKCE
// (code_verifier/code_challenge) -> state y code_verifier se setean como
// cookies httpOnly DIRECTAMENTE sobre el NextResponse de redirect a Mercado
// Pago (nunca vía cookies() de next/headers: en un GET seguido de redirect,
// eso puede terminar sin adjuntarse de forma confiable a la respuesta real
// que ve el browser) -> se redirige a Mercado Pago. El callback valida
// ambos antes de intercambiar el `code`.

import { type NextRequest, NextResponse } from 'next/server';
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
// se corta acá.
//
// Ojo: la fuente de verdad sobre "¿esto es Production?" NO es el host. Detrás
// de Vercel, x-forwarded-host/host pueden reflejar infraestructura interna
// (edge, dominios de Vercel, etc.) y no el environment real del deployment —
// eso fue justamente lo que rompió el guard anterior basado en host una vez
// mergeado a Production. La fuente de verdad es process.env.VERCEL_ENV, que
// Vercel setea de forma confiable en runtime: 'production' | 'preview' |
// 'development'. El host público sigue usándose, pero solo para UNA cosa:
// mandar el apex (turniahealth.com.ar, sin www) a www antes de generar
// cookies, para que nazcan bajo el dominio que el callback espera.
const MP_CANONICAL_HOST = 'www.turniahealth.com.ar';
const MP_APEX_HOST = 'turniahealth.com.ar';
const MP_BLOCKED_MESSAGE = 'La conexión con Mercado Pago debe realizarse desde la versión de producción de TurnIA.';

// Detecta el host público real de la request, priorizando las cabeceras que
// setea el proxy (útil solo para el redirect de apex -> www, ver más abajo):
//   1. x-forwarded-host (si el proxy encadena varios, tomamos el primero)
//   2. host
//   3. request.nextUrl.host como último fallback
// Normalizado a lowercase, sin espacios y sin puerto.
function getPublicHost(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const rawHost = forwardedHost ? forwardedHost.split(',')[0] : request.headers.get('host') ?? request.nextUrl.host;

  return rawHost.trim().toLowerCase().replace(/:\d+$/, '');
}

// Única fuente de verdad sobre el environment: VERCEL_ENV. 'production'
// habilita el flujo; 'preview', 'development', o ausente (fail closed) lo
// bloquean. No confiar en NODE_ENV ni en el host para esto.
function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

export async function GET(request: NextRequest) {
  // Exige sesión + tenant, igual que cualquier página de /(protected)/.
  await requireTenant();

  const publicHost = getPublicHost(request);

  // Apex sin www: todavía no generamos state/PKCE/cookies. Redirigimos de
  // una al mismo path bajo www para que esas cookies nazcan directamente
  // en el dominio que Mercado Pago va a usar para volver al callback
  // (https://www.turniahealth.com.ar/api/integrations/mercadopago/oauth/callback).
  if (publicHost === MP_APEX_HOST) {
    return NextResponse.redirect(`https://${MP_CANONICAL_HOST}/api/integrations/mercadopago/oauth/connect`);
  }

  // Gate real de Production: VERCEL_ENV === 'production'. Preview y
  // development quedan bloqueados aunque el host de la request "parezca"
  // www.turniahealth.com.ar.
  if (!isProductionEnvironment()) {
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(MP_BLOCKED_MESSAGE)}#integraciones`, request.url));
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

  // Cookies seteadas DIRECTAMENTE sobre la response de redirect (no vía
  // cookies() de next/headers) para garantizar que viajan en la respuesta
  // real que recibe el browser. Host-only a propósito: sin `domain`, para
  // que sólo existan en el host exacto que las setea (www.turniahealth.com.ar
  // en producción, nunca .turniahealth.com.ar).
  const response = NextResponse.redirect(authUrlResult.data);
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
  response.cookies.set(STATE_COOKIE, state, cookieOptions);
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOptions);

  return response;
}
