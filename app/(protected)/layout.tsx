import { requireTenant } from '@/lib/auth/require-user';
import { logout } from '@/app/login/actions';
import { AppShell } from '@/components/app-shell/AppShell';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, role } = await requireTenant();

  return (
    <AppShell email={user.email ?? ''} role={role} logoutAction={logout}>
      {children}
    </AppShell>
  );
}
