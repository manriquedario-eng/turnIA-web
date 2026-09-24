import { NextRequest, NextResponse } from 'next/server';
import { processAppointmentReminders24h } from '@/lib/appointments/reminders-24h';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await processAppointmentReminders24h();

  if (!result.ok) {
    console.error('Appointment reminders 24h failed', { reason: result.reason });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  console.log('Appointment reminders 24h processed', {
    scanned: result.scanned,
    eligible: result.eligible,
    processed: result.processed,
    errors: result.errors,
    channelAttempts: result.channelAttempts,
    channelFailures: result.channelFailures,
    pages: result.pages,
  });

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    eligible: result.eligible,
    processed: result.processed,
    errors: result.errors,
    channelAttempts: result.channelAttempts,
    channelFailures: result.channelFailures,
    pages: result.pages,
  });
}
