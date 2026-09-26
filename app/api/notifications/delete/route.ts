import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  const { user, tenantId } = await requireTenant();
  const supabase = createSupabaseServiceClient();

  let body: { id?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await supabase
    .from('appointment_action_alerts')
    .delete()
    .eq('id', body.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id);

  if (error) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
