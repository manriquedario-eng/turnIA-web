// Callback de Google OAuth. Valida el `state` (CSRF) contra la cookie
// seteada en /api/google/oauth/connect, exige sesión válida (requireTenant),
// intercambia el code por tokens y los guarda server-side. Nunca expone
// tokens en la respuesta ni en la URL de redirect: siempre redirige a
// /settings con, a lo sumo, un mensaje de ok/error en texto plano.

import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireTenant } from '@/lib/auth/require-user';
import { completeGoogleOAuthConnection } from '@/lib/google/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'turnia_google_oauth_state';

export async function GET(request: NextRequest) {
  const { tenantId, user } = await requireTenant();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const googleError = searchParams.get('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  // La cookie de state es de un solo uso: se borra se use o no.
  cookieStore.delete(STATE_COOKIE);

  if (googleError) {
    // El profesional canceló el consentimiento u otro error de Google. No
    // es un fallo de la app: no se loguea como error, se informa sin más.
    return NextResponse.redirect(new URL('/settings?error=Conexi%C3%B3n%20con%20Google%20cancelada', request.url));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    console.warn('Google OAuth callback: state inválido o code ausente');
    return NextResponse.redirect(new URL('/settings?error=No%20se%20pudo%20validar%20la%20conexi%C3%B3n%20con%20Google', request.url));
  }

  const result = await completeGoogleOAuthConnection({ tenantId, userId: user.id, code });

  if (!result.ok) {
    // Sanitizado: nunca el code, nunca tokens, sólo un mensaje de error ya
    // acotado por completeGoogleOAuthConnection.
    console.error('Google OAuth callback: no se pudo completar la conexión', result.errorMessage);
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(result.errorMessage)}`, request.url));
  }

  return NextResponse.redirect(new URL('/settings?ok=Google%20conectado', request.url));
}
