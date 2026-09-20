import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { supabase, user, tenantId } = await requireTenant();

  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('professional_reminders')
    .select('id,title,description,remind_at,status')
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'pending')
    .lte('remind_at', horizon.toISOString())
    .order('remind_at', { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ reminders: [] }, { status: 500 });
  }

  return NextResponse.json(
    { reminders: data ?? [] },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
