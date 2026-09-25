import type { Metadata } from 'next';
import { getMercadoPagoPaymentOfferByToken } from '@/lib/mercadopago/payment-offer';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

function messageForReason(reason: string): string {
  if (reason === 'already_paid') return 'Este turno ya no tiene saldo pendiente.';
  if (reason === 'payment_review_required') return 'Este turno tiene un pago en revisión y no admite un nuevo cobro online por ahora.';
  if (reason === 'not_confirmed') return 'El pago online se habilita cuando el turno está confirmado.';
  if (reason === 'appointment_started') return 'El pago online de este turno ya no está disponible desde este enlace.';
  if (reason === 'not_connected') return 'El profesional todavía no tiene disponible el cobro online para este turno.';
  if (reason === 'patient_email_required') return 'Falta un email válido del paciente para iniciar el pago online.';
  if (reason === 'no_amount') return 'Este turno no tiene un importe configurado para cobrar online.';
  return 'El pago online no está disponible en este momento.';
}

export default async function PublicPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const offer = await getMercadoPagoPaymentOfferByToken(token);

  return (
    <main className="login-wrap">
      <section className="card login-card" style={{ maxWidth: 420 }}>
        <p
          className="muted"
          style={{
            fontSize: 12,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          TurnIA
        </p>
        <h1 style={{ marginTop: 0 }}>Pago del turno</h1>

        {query.error ? (
          <p className="alert error">No pudimos iniciar el pago. Probá nuevamente en unos minutos.</p>
        ) : null}

        {offer.available ? (
          <>
            <p>Tu turno está confirmado. Si querés, podés abonar ahora con Mercado Pago.</p>
            <div className="card" style={{ margin: '16px 0' }}>
              <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                Saldo pendiente
              </span>
              <strong style={{ fontSize: 24 }}>
                {new Intl.NumberFormat('es-AR', {
                  style: 'currency',
                  currency: offer.currency,
                }).format(offer.remainingAmount)}
              </strong>
            </div>
            <form method="post" action={`/api/payments/appointment/${token}`}>
              <button className="btn" type="submit" style={{ width: '100%' }}>
                Pagar con Mercado Pago
              </button>
            </form>
            <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
              El pago se registra en TurnIA únicamente cuando Mercado Pago confirma la operación.
            </p>
          </>
        ) : (
          <p className="muted">{messageForReason(offer.reason)}</p>
        )}
      </section>
    </main>
  );
}
