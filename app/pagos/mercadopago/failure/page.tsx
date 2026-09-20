import Link from 'next/link';

// Página pública de retorno de Mercado Pago cuando la operación no se
// completó (config.online.failure_url en lib/mercadopago/orders.ts). Mismo
// criterio que success/page.tsx: pública, sin login, sin datos clínicos/
// sensibles, 100% estática.
export default function MercadoPagoFailurePage() {
  return (
    <main className="login-wrap">
      <section className="card login-card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <p className="muted" style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          TurnIA
        </p>
        <h1 style={{ marginTop: 0 }}>El pago no se completó</h1>
        <p>
          No se registró el cobro en TurnIA. Podés intentar nuevamente desde el enlace de pago.
        </p>
        <p style={{ marginTop: 24 }}>
          <Link className="btn secondary" href="/">Volver a TurnIA</Link>
        </p>
      </section>
    </main>
  );
}
