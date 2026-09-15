import { requireTenant } from '@/lib/auth/require-user';
import { logout } from '@/app/login/actions';
import { AppShell } from '@/components/app-shell/AppShell';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, role } = await requireTenant();
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  const name = profile?.display_name || user.email || 'Profesional';

  return (
    <AppShell name={name} role={role} logoutAction={logout}>
      {children}
    </AppShell>
  );
}
