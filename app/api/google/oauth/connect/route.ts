// Inicia el flujo de Google OAuth para EL PROFESIONAL logueado (no una
// cuenta compartida de tenant). GET porque se llega acá desde un link
// normal en Settings, nunca desde un fetch/XHR.
//
// Flujo: requireTenant() exige sesión válida -> se genera un `state`
// aleatorio (CSRF) que se guarda en una cookie httpOnly de corta vida -> se
// redirige a Google. El callback valida que el `state` que Google devuelve
// coincide con la cookie antes de hacer nada.

import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { requireTenant } from '@/lib/auth/require-user';
import { buildGoogleAuthUrl, isGoogleOAuthConfigured } from '@/lib/google/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'turnia_google_oauth_state';

export async function GET(request: NextRequest) {
  // Exige sesión + tenant, igual que cualquier página de /(protected)/.
  await requireTenant();

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(
      new URL('/settings?error=Conexi%C3%B3n%20con%20Google%20no%20configurada%20en%20el%20servidor%20todav%C3%ADa', request.url)
    );
  }

  const state = randomBytes(24).toString('hex');
  const authUrlResult = buildGoogleAuthUrl(state);

  if (!authUrlResult.ok) {
    return NextResponse.redirect(
      new URL('/settings?error=No%20se%20pudo%20iniciar%20la%20conexi%C3%B3n%20con%20Google', request.url)
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutos: tiempo de sobra para completar el consentimiento
    path: '/',
  });

  return NextResponse.redirect(authUrlResult.data);
}
