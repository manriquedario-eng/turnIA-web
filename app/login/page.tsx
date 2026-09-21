import { login } from './actions';
import { IconMail, IconLock } from '@/components/ui/icons';

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const error = params.error;

  return (
    <main className="login-shell">
      <div className="login-hero">
        <span className="login-hero-tagline">
          Profesionales más humanos en un mundo más sano.
        </span>

        <div className="login-hero-top">
          <span className="brand-mark" />
        </div>

        <h1 className="login-hero-heading">
          Tu tiempo también <em>importa.</em>
        </h1>
        <p className="login-hero-copy">
          TurnIA te ayuda a gestionar tus turnos, pacientes y agenda en un solo lugar,
          de manera simple y humana.
        </p>

        <div className="login-benefits">
          <div className="login-benefit">
            <span className="icon-circle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </span>
            <span className="login-benefit-copy">
              <span className="login-benefit-title">Menos administración</span>
              <span className="login-benefit-desc">Más tiempo para tus pacientes.</span>
            </span>
          </div>

          <div className="login-benefit">
            <span className="icon-circle is-lilac">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="login-benefit-copy">
              <span className="login-benefit-title">Una agenda que se adapta a vos</span>
            </span>
          </div>

          <div className="login-benefit">
            <span className="icon-circle is-mauve">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 2.6 4.8 6 4.1c2-.4 3.9.5 5 2 .1.2.3.2.5 0 1.1-1.5 3-2.4 5-2 3.4.7 5.1 4.1 3.6 7.6C19.5 16.4 12 21 12 21Z" />
              </svg>
            </span>
            <span className="login-benefit-copy">
              <span className="login-benefit-title">Tecnología al servicio</span>
              <span className="login-benefit-desc">de una salud más humana.</span>
            </span>
          </div>
        </div>

        <div className="login-hero-footer">Turnos · Pacientes · Más vida</div>
      </div>

      <div className="login-panel-wrap">
        <section className="card login-card">
          <div className="login-card-eyebrow">Bienvenido a</div>
          <div className="login-card-brand brand-mark" />
          <p className="muted" style={{ marginTop: 10 }}>Ingresá a tu cuenta para continuar.</p>
          {error ? (
            <div className="error" style={{ marginTop: 14 }}>
              {error === 'too_many_attempts'
                ? 'Demasiados intentos. Esperá unos minutos y volvé a intentar.'
                : 'No pudimos iniciar sesión. Revisá tus datos.'}
            </div>
          ) : null}
          <form action={login} style={{ marginTop: 18 }}>
            <label className="field login-field-icon">
              <span>Email</span>
              <IconMail size={15} />
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field login-field-icon">
              <span>Contraseña</span>
              <IconLock size={15} />
              <input name="password" type="password" autoComplete="current-password" required />
            </label>

            <button className="btn" type="submit" style={{ width: '100%', marginTop: 12 }}>
              Ingresar →
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
