import Link from 'next/link';

// Página pública de retorno de Mercado Pago (Checkout Pro / Orders API) tras
// un pago aparentemente exitoso — a la que Mercado Pago redirige al
// paciente (config.online.success_url en lib/mercadopago/orders.ts). La
// abre el paciente, nunca requiere cuenta TurnIA (mismo criterio que
// app/t/[token]/page.tsx) y no muestra nada clínico ni sensible.
//
// IMPORTANTE (PARTE 7 del pedido): esta URL de retorno NO es la fuente
// autoritativa de nada — es sólo a dónde Mercado Pago redirige el
// navegador del paciente después del checkout, sin que TurnIA la valide de
// ninguna forma. La confirmación real del pago pasa siempre por el webhook
// server-side (app/api/mercadopago/webhook/route.ts) + la conciliación
// contra la Orders API (lib/mercadopago/reconcile.ts), que puede completarse
// unos segundos después de que el paciente ya esté viendo esta pantalla. Por
// eso el texto NUNCA afirma "pago acreditado" acá — sólo que Mercado Pago
// procesó la operación y que TurnIA está confirmando el estado real.
//
// Sin queries a Supabase ni a Mercado Pago: página 100% estática, no hay
// nada seguro que mostrar acá que no sea potencialmente prematuro o (peor)
// un dato de otro pago si se confiara en query params del browser.
export default function MercadoPagoSuccessPage() {
  return (
    <main className="login-wrap">
      <section className="card login-card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <p className="muted" style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          TurnIA
        </p>
        <h1 style={{ marginTop: 0 }}>Pago recibido</h1>
        <p>
          Volviste de Mercado Pago. TurnIA está confirmando el estado del pago.
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
