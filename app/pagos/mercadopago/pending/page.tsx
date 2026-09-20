import Link from 'next/link';

// Página pública de retorno de Mercado Pago cuando la operación quedó
// pendiente de confirmación (config.online.pending_url en
// lib/mercadopago/orders.ts). Mismo criterio que success/page.tsx: pública,
// sin login, sin datos clínicos/sensibles, 100% estática — la confirmación
// real siempre pasa por el webhook + lib/mercadopago/reconcile.ts, nunca
// por esta URL de retorno.
export default function MercadoPagoPendingPage() {
  return (
    <main className="login-wrap">
      <section className="card login-card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <p className="muted" style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          TurnIA
        </p>
        <h1 style={{ marginTop: 0 }}>Pago pendiente</h1>
        <p>
          Mercado Pago informó que la operación todavía está pendiente de confirmación.
        </p>
        <p className="muted">
          Ya podés cerrar esta ventana o volver a TurnIA.
        </p>
        <p style={{ marginTop: 24 }}>
          <Link className="btn secondary" href="/">Volver a TurnIA</Link>
        </p>
      </section>
    </main>
  );
}
