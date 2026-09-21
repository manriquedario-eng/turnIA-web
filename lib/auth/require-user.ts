import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) redirect('/login');
  return { supabase, user };
}

export async function requireTenant() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single();

  if (error || !data) redirect('/login?error=no_tenant');

  return {
    supabase,
    user,
    tenantId: data.tenant_id as string,
    role: data.role as string,
  };
}
