import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { logout } from '@/app/login/actions';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, role } = await requireTenant();

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand">TurnIA</div>
          <div className="muted" style={{ fontSize: 12 }}>{user.email} · {role}</div>
        </div>
        <nav className="nav">
          <Link href="/dashboard">Inicio</Link>
          <Link href="/agenda">Agenda</Link>
          <Link href="/patients">Pacientes</Link>
          <form action={logout}><button className="btn secondary" type="submit">Salir</button></form>
        </nav>
      </header>
      <main className="container">{children}</main>
    </div>
  );
}
