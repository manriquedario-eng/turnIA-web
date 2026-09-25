import { NextRequest, NextResponse } from 'next/server';
import { processAppointmentReminders24h } from '@/lib/appointments/reminders-24h';
import { requireTenant } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const isPreview = process.env.VERCEL_ENV === 'preview';

  let tenantId: string | undefined;

  if (isPreview && !auth) {
    // Preview: Vercel no ejecuta Cron Jobs. Permitimos una ejecución manual
    // únicamente a un usuario autenticado de TurnIA y restringida a su tenant.
    // Producción nunca entra en esta rama.
    const tenant = await requireTenant();
    tenantId = tenant.tenantId;
  } else if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await processAppointmentReminders24h(new Date(), { tenantId });

  if (!result.ok) {
    console.error('Appointment reminders 24h failed', { reason: result.reason });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  console.log('Appointment reminders 24h processed', {
    scanned: result.scanned,
    eligible: result.eligible,
    processed: result.processed,
    errors: result.errors,
    pages: result.pages,
  });

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    eligible: result.eligible,
    processed: result.processed,
    errors: result.errors,
    pages: result.pages,
  });
}
