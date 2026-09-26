import Link from 'next/link';

type Props = { searchParams: Promise<{ email?: string }> };

export default async function CheckEmailPage({ searchParams }: Props) {
  const { email } = await searchParams;

  return (
    <main className="login-shell">
      <div className="login-hero">
        <span className="login-hero-tagline">Un último paso.</span>
        <div className="login-hero-top">
          <span className="brand-mark" />
        </div>
        <h1 className="login-hero-heading">
          Revisá tu <em>correo.</em>
        </h1>
        <p className="login-hero-copy">
          Te enviamos un enlace para confirmar tu cuenta de TurnIA.
        </p>
      </div>

      <div className="login-panel-wrap">
        <section className="card login-card">
          <div className="login-card-eyebrow">Confirmación de cuenta</div>
          <div className="login-card-brand brand-mark" />
          <p style={{ marginTop: 16 }}>
            Abrí el correo que enviamos{email ? <> a <strong>{email}</strong></> : null} y hacé clic en el enlace de confirmación.
          </p>
          <p className="muted" style={{ marginTop: 12 }}>
            Hasta confirmar el correo no vas a poder ingresar a TurnIA.
          </p>
          <Link className="btn" href="/login" style={{ width: '100%', marginTop: 18, textAlign: 'center' }}>
            Volver al ingreso
          </Link>
        </section>
      </div>
    </main>
  );
}
