import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export async function POST(request: NextRequest) {
  const { supabase, user, tenantId } = await requireTenant();

  let body: { id?: string; all?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let query = supabase
    .from('appointment_action_alerts')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .is('read_at', null);

  if (!body.all) {
    if (!body.id) return NextResponse.json({ ok: false }, { status: 400 });
    query = query.eq('id', body.id);
  }

  const { error } = await query;

  if (error) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
