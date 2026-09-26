import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { supabase, user, tenantId } = await requireTenant();

  const { count, error } = await supabase
    .from('appointment_action_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .is('read_at', null);

  if (error) {
    return NextResponse.json({ count: 0 }, { status: 500 });
  }

  return NextResponse.json(
    { count: count ?? 0 },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
