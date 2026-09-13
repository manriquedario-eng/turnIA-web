import { login } from './actions';

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const error = params.error;

  return (
    <main className="login-wrap">
      <section className="card login-card">
        <h1>TurnIA</h1>
        <p className="muted">Ingresá a tu espacio profesional.</p>
        {error ? <div className="error">No pudimos iniciar sesión. Revisá tus datos.</div> : null}
        <form action={login}>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="btn" type="submit">Ingresar</button>
        </form>
      </section>
    </main>
  );
}
