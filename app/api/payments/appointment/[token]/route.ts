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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    fetchSite === 'cross-site'
  ) {
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
