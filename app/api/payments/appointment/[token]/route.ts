import { NextRequest, NextResponse } from 'next/server';
import { createMercadoPagoCheckoutForAppointment } from '@/lib/mercadopago/orders';
import { getMercadoPagoPaymentOfferByToken } from '@/lib/mercadopago/payment-offer';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function backToPaymentPage(request: NextRequest, token: string) {
  return NextResponse.redirect(new URL(`/pagar/${token}?error=1`, request.url), 303);
}

function isTrustedSameSitePost(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;

  const forwardedHost = request.headers.get('x-forwarded-host')?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '');

  const expectedOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
  const origin = request.headers.get('origin');

  if (origin) {
    return origin === expectedOrigin;
  }

  // Algunos navegadores embebidos/webviews omiten Origin en un POST de
  // formulario HTML legítimo. Si hay Referer, exigimos que siga siendo de
  // TurnIA. Si tampoco viene, Sec-Fetch-Site ya bloquea navegadores modernos
  // cross-site y el endpoint conserva token público impredecible + rate limit.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return true;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!isTrustedSameSitePost(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const ip = await getClientIp();
  const limits = [
    checkRateLimit({
      scope: 'public-payment-token',
      key: token,
      windowSeconds: 3600,
      maxCount: 8,
    }),
    ...(ip
      ? [
          checkRateLimit({
            scope: 'public-payment-ip',
            key: ip,
            windowSeconds: 900,
            maxCount: 40,
          }),
        ]
      : []),
  ];

  const rateResults = await Promise.all(limits);
  if (rateResults.some((result) => !result.allowed)) {
    return backToPaymentPage(request, token);
  }

  const offer = await getMercadoPagoPaymentOfferByToken(token);

  if (!offer.available) {
    return backToPaymentPage(request, token);
  }

  const checkout = await createMercadoPagoCheckoutForAppointment({
    tenantId: offer.tenantId,
    userId: offer.professionalId,
    appointmentId: offer.appointmentId,
  });

  if (!checkout.ok) {
    return backToPaymentPage(request, token);
  }

  const response = NextResponse.redirect(checkout.checkoutUrl, 303);
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
