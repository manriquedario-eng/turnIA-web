import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { processAppointmentReminders24h } from '@/lib/appointments/reminders-24h';
import { getWhatsAppIntegrationStatus } from '@/lib/whatsapp/provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { tenantId } = await requireTenant();
  const result = await processAppointmentReminders24h(new Date(), tenantId);
  const whatsapp = getWhatsAppIntegrationStatus();

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    eligible: result.eligible,
    processed: result.processed,
    errors: result.errors,
    window: result.window,
    whatsapp: {
      baseConfigured: whatsapp.baseConfigured,
      reminderTemplateConfigured: whatsapp.reminderTemplateConfigured,
      webhookConfigured: whatsapp.webhookConfigured,
    },
  });
}
