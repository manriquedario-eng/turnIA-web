import { login } from './actions';
import { IconMail, IconLock, IconEye } from '@/components/ui/icons';

type Props = { searchParams: Promise<{ error?: string }> };

// Rediseño Concepto C — Editorial Minimal, traducido 1:1 desde la imagen de
// referencia aprobada (blueprint): una sola atmósfera cálida (no un split
// duro en dos columnas), contenido editorial flotando a la izquierda y la
// tarjeta de acceso flotando a la derecha con sombra real. Misma server
// action, mismos campos, mismo manejo de error — sólo cambia la
// presentación. "Recordar sesión", "¿Olvidaste tu contraseña?", los
// botones Google/Microsoft y "Crear cuenta" son presentacionales: no hay
// lógica de backend para ninguno de ellos en actions.ts todavía (no hay
// OAuth, recuperación de contraseña ni alta de cuenta) — se agregan acá
// sólo para replicar fielmente la composición visual de la referencia.
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

        <div className="login-hero-footer">Turnos · Pacientes · Equipo · Más vida</div>
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
              <span className="login-field-toggle" aria-hidden="true"><IconEye size={15} /></span>
            </label>

            <div className="login-form-row">
              <label className="login-remember">
                <input type="checkbox" name="remember" />
                Recordarme
              </label>
              <a href="#" className="login-forgot">¿Olvidaste tu contraseña?</a>
            </div>

            <button className="btn" type="submit" style={{ width: '100%', marginTop: 4 }}>Ingresar →</button>
          </form>

          <div className="login-divider">o ingresá con</div>
          <div className="login-oauth-row">
            <span className="btn-oauth">
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
                <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2.02H10v3.83h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 3-4.32 3-7.33Z" />
                <path fill="#34A853" d="M10 20c2.7 0 4.97-.89 6.63-2.42l-3.24-2.5c-.9.6-2.06.96-3.39.96-2.6 0-4.8-1.76-5.6-4.12H1.06v2.59A10 10 0 0 0 10 20Z" />
                <path fill="#FBBC05" d="M4.4 11.92a6 6 0 0 1 0-3.84V5.49H1.06a10 10 0 0 0 0 9.02l3.34-2.59Z" />
                <path fill="#EA4335" d="M10 3.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.7 9.7 0 0 0 10 0 10 10 0 0 0 1.06 5.49L4.4 8.08C5.2 5.72 7.4 3.96 10 3.96Z" />
              </svg>
              Google
            </span>
            <span className="btn-oauth">
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="1" y="1" width="8.5" height="8.5" fill="#F35325" />
                <rect x="10.5" y="1" width="8.5" height="8.5" fill="#81BC06" />
                <rect x="1" y="10.5" width="8.5" height="8.5" fill="#05A6F0" />
                <rect x="10.5" y="10.5" width="8.5" height="8.5" fill="#FFBA08" />
              </svg>
              Microsoft
            </span>
          </div>

          <div className="login-signup">¿No tenés cuenta? <a href="#">Crear cuenta</a></div>
        </section>
      </div>
    </main>
  );
}
