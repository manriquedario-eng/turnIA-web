import { NextRequest, NextResponse } from 'next/server';
import { createMercadoPagoCheckoutForAppointment } from '@/lib/mercadopago/orders';
import { getMercadoPagoPaymentOfferByToken } from '@/lib/mercadopago/payment-offer';

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

  return NextResponse.redirect(checkout.checkoutUrl, 303);
}
