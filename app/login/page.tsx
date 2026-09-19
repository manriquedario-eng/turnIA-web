import { login } from './actions';

type Props = { searchParams: Promise<{ error?: string }> };

// Rediseño Concepto C — Editorial Minimal. Layout partido: columna izquierda
// = identidad de marca + mensaje editorial + beneficios; columna derecha =
// panel de acceso. Misma server action, mismos campos, mismo manejo de
// error — sólo cambia la presentación. "Recordar sesión" y "¿Olvidaste tu
// contraseña?" son presentacionales (no hay lógica de backend para ninguno
// de los dos todavía); no se agregan botones de Google/Microsoft porque no
// hay soporte OAuth preparado en actions.ts.
export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const error = params.error;

  return (
    <main className="login-shell">
      <aside className="login-aside">
        <div className="login-aside-top">
          <span className="brand-mark" />
        </div>

        <div className="login-aside-content">
          <div className="login-aside-eyebrow">Espacio profesional</div>
          <h1 className="login-aside-heading">Tu tiempo también importa.</h1>
          <p className="login-aside-copy">
            TurnIA ordena la agenda, las fichas y los cobros de tu consultorio para que
            dediques el tiempo a las personas, no a la administración.
          </p>

          <div className="login-benefits">
            <div className="login-benefit">
              <span className="icon-circle is-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </span>
              <span className="login-benefit-copy">
                <span className="login-benefit-title">Agenda clara</span>
                <span className="login-benefit-desc">Turnos organizados de un vistazo, sin superponer datos.</span>
              </span>
            </div>

            <div className="login-benefit">
              <span className="icon-circle is-sm is-lilac">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <span className="login-benefit-copy">
                <span className="login-benefit-title">Pacientes al día</span>
                <span className="login-benefit-desc">Fichas, sesiones y seguimiento en un mismo lugar.</span>
              </span>
            </div>

            <div className="login-benefit">
              <span className="icon-circle is-sm is-sand">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
              </span>
              <span className="login-benefit-copy">
                <span className="login-benefit-title">Menos administración</span>
                <span className="login-benefit-desc">Recordatorios y cobros que se resuelven casi solos.</span>
              </span>
            </div>
          </div>
        </div>

        <div className="login-aside-footer">© {new Date().getFullYear()} TurnIA</div>
      </aside>

      <div className="login-panel-wrap">
        <section className="card login-card">
          <div className="login-card-eyebrow">Ingresar</div>
          <h1 style={{ fontSize: 24 }}>Bienvenido a TurnIA</h1>
          <p className="muted" style={{ marginTop: 4 }}>Ingresá a tu espacio profesional.</p>
          {error ? (
            <div className="error" style={{ marginTop: 14 }}>
              {error === 'too_many_attempts'
                ? 'Demasiados intentos. Esperá unos minutos y volvé a intentar.'
                : 'No pudimos iniciar sesión. Revisá tus datos.'}
            </div>
          ) : null}
          <form action={login} style={{ marginTop: 18 }}>
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field">
              <span>Contraseña</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>

            <div className="login-form-row">
              <label className="login-remember">
                <input type="checkbox" name="remember" />
                Recordar sesión
              </label>
              <a href="#" className="login-forgot">¿Olvidaste tu contraseña?</a>
            </div>

            <button className="btn" type="submit" style={{ width: '100%', marginTop: 4 }}>Ingresar</button>
          </form>
        </section>
      </div>
    </main>
  );
}
