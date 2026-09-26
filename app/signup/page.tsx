import Link from 'next/link';
import { signup } from './actions';
import { IconMail, IconLock } from '@/components/ui/icons';

type Props = { searchParams: Promise<{ error?: string }> };

function errorMessage(error?: string): string | null {
  switch (error) {
    case 'missing_fields':
      return 'Completá todos los campos.';
    case 'invalid_email':
      return 'Ingresá un correo válido.';
    case 'weak_password':
      return 'La contraseña debe tener al menos 10 caracteres.';
    case 'invalid_name':
      return 'Ingresá tu nombre profesional.';
    case 'registration_closed':
      return 'El registro de nuevas cuentas todavía no está abierto.';
    case 'not_invited':
      return 'Este correo no está habilitado para participar de esta etapa de TurnIA.';
    case 'server_configuration':
      return 'El registro todavía no está habilitado en este entorno.';
    case 'signup_failed':
      return 'No pudimos crear la cuenta. Revisá los datos o intentá nuevamente.';
    default:
      return null;
  }
}

export default async function SignupPage({ searchParams }: Props) {
  const params = await searchParams;
  const message = errorMessage(params.error);

  return (
    <main className="login-shell">
      <div className="login-hero">
        <span className="login-hero-tagline">Tu espacio profesional empieza acá.</span>
        <div className="login-hero-top">
          <span className="brand-mark" />
        </div>
        <h1 className="login-hero-heading">
          Creá tu espacio en <em>TurnIA.</em>
        </h1>
        <p className="login-hero-copy">
          Registrate con tu correo profesional. Antes de ingresar vamos a verificar que el correo realmente sea tuyo.
        </p>
        <div className="login-hero-footer">Una cuenta · Un profesional · Tus pacientes</div>
      </div>

      <div className="login-panel-wrap">
        <section className="card login-card">
          <div className="login-card-eyebrow">Crear cuenta</div>
          <div className="login-card-brand brand-mark" />
          <p className="muted" style={{ marginTop: 10 }}>
            Después de registrarte te enviaremos un correo de confirmación.
          </p>

          {message ? (
            <div className="error" style={{ marginTop: 14 }}>{message}</div>
          ) : null}

          <form action={signup} style={{ marginTop: 18 }}>
            <label className="field">
              <span>Nombre y apellido</span>
              <input name="display_name" type="text" autoComplete="name" maxLength={120} required />
            </label>

            <label className="field login-field-icon">
              <span>Email</span>
              <IconMail size={15} />
              <input name="email" type="email" autoComplete="email" required />
            </label>

            <label className="field login-field-icon">
              <span>Contraseña</span>
              <IconLock size={15} />
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                required
              />
            </label>

            <button className="btn" type="submit" style={{ width: '100%', marginTop: 12 }}>
              Crear cuenta →
            </button>
          </form>

          <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
            ¿Ya tenés cuenta? <Link href="/login">Ingresar</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
