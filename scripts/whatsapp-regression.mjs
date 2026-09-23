import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const passes = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function check(name, condition, detail = '') {
  if (condition) passes.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

const provider = read('lib/whatsapp/provider.ts');
const webhook = read('app/api/whatsapp/webhook/route.ts');
const actions = read('lib/whatsapp/appointment-actions.ts');
const created = read('lib/whatsapp/send-appointment-created.ts');
const reminder = read('lib/appointments/reminders-24h.ts');
const notification = read('lib/appointments/reschedule-notifications.ts');
const migration = read('supabase/migrations/20260923174500_whatsapp_interaction_hardening.sql');
const cronRoute = read('app/api/cron/appointment-reminders-24h/route.ts');
const vercel = read('vercel.json');
const envExample = read('.env.example');
const settings = read('app/(protected)/settings/page.tsx');
const settingsActions = read('app/(protected)/settings/actions.ts');
const professionalContactsMigration = read('supabase/migrations/20260923183500_professional_contacts.sql');
const idempotentRescheduleMigration = read('supabase/migrations/20260923185500_idempotent_reschedule_requests.sql');
const publicToken = read('lib/appointments/public-token.ts');
const agendaPage = read('app/(protected)/agenda/page.tsx');

check(
  'WhatsApp secrets are never NEXT_PUBLIC',
  !/NEXT_PUBLIC_WHATSAPP_/i.test([
    provider, webhook, actions, created, reminder, notification, envExample,
  ].join('\n')),
);

check(
  'Graph API default is v25.0 branch baseline',
  provider.includes("WHATSAPP_GRAPH_API_VERSION || 'v25.0'") &&
    envExample.includes('WHATSAPP_GRAPH_API_VERSION=v25.0'),
);

check(
  'Meta requests have an explicit timeout and sanitized provider errors',
  provider.includes('META_REQUEST_TIMEOUT_MS = 10_000') &&
    provider.includes('AbortSignal.timeout(META_REQUEST_TIMEOUT_MS)') &&
    provider.includes('metaErrorMessage(json, response.status)'),
);

check(
  'Webhook fails closed without Meta App Secret',
  webhook.includes("const appSecret = process.env.WHATSAPP_APP_SECRET") &&
    webhook.includes("status: 403") &&
    webhook.includes('isValidMetaSignature'),
);

check(
  'Webhook validates HMAC using timing-safe comparison',
  webhook.includes("createHmac('sha256'") &&
    webhook.includes('timingSafeEqual'),
);

check(
  'Webhook scopes events to expected Phone Number ID',
  webhook.includes('WHATSAPP_PHONE_NUMBER_ID') &&
    webhook.includes('value.metadata?.phone_number_id'),
);

check(
  'Appointment button payloads are namespaced and token-bound',
  created.includes('turnia:appointment:${publicToken}:confirm') &&
    created.includes('turnia:appointment:${publicToken}:cancel') &&
    created.includes('turnia:appointment:${publicToken}:reschedule'),
);

check(
  'WhatsApp actions require sender to match patient phone',
  actions.includes('senderDigits !== patientDigits') &&
    actions.includes("error_message: 'sender_mismatch'"),
);

check(
  'WhatsApp actions bind Meta context to sent appointment message when supplied',
  actions.includes('input.contextMessageId') &&
    actions.includes("eq('provider_message_id', input.contextMessageId)") &&
    actions.includes("eq('appointment_id', appointment.id)"),
);

check(
  'WhatsApp button context is limited to patient appointment messages',
  actions.includes("new Set(['appointment_created', 'appointment_reminder_24h'])") &&
    actions.includes('allowedContextTypes.has(contextMessage.message_type)'),
);

check(
  'Transient action ledger DB failures are retryable',
  actions.includes('if (eventInsertError)') &&
    actions.includes('throw eventInsertError'),
);

check(
  'Inbound webhook actions are idempotent',
  migration.includes('create table if not exists public.whatsapp_inbound_events') &&
    actions.includes("eventInsertError?.code === '23505'"),
);

check(
  'Inbound action ledger is service-role only',
  migration.includes('alter table public.whatsapp_inbound_events enable row level security') &&
    migration.includes('revoke all on table public.whatsapp_inbound_events from anon, authenticated'),
);

check(
  'Delivery lifecycle never intentionally regresses',
  webhook.includes('if (incomingRank < currentRank) return') &&
    webhook.includes('delivered_at') &&
    webhook.includes('read_at') &&
    webhook.includes('failed_at'),
);

check(
  'Signed valid webhook failures return retryable 500',
  webhook.includes('error transitorio procesando evento') &&
    webhook.includes('status: 500'),
);

check(
  'Initial WhatsApp confirmation is independent from reminder opt-in',
  created.includes('void appointmentRemindersOptIn') &&
    !/if\s*\(!appointmentRemindersOptIn\)/.test(created),
);

check(
  '24h reminder requires explicit reminder opt-in',
  reminder.includes('!patient.appointment_reminders_opt_in'),
);

check(
  '24h reminder WhatsApp also requires WhatsApp consent',
  reminder.includes('whatsappConsent: Boolean(patient.whatsapp_consent)') &&
    reminder.includes('if (!params.phoneE164 || !params.whatsappConsent) return'),
);

check(
  'Reminder and professional alerts use cycle-based dedupe keys',
  migration.includes('dedupe_key text') &&
    migration.includes('appointment_messages_dedupe_key_unique') &&
    reminder.includes('appointment_reminder_24h:${params.startsAt}') &&
    notification.includes('professional_reschedule_requested:${rescheduleCycle}'),
);

check(
  'Cron endpoint requires CRON_SECRET',
  cronRoute.includes('process.env.CRON_SECRET') &&
    cronRoute.includes("request.headers.get('authorization')") &&
    cronRoute.includes('Bearer ${cronSecret}'),
);

check(
  'Cron is scheduled every 15 minutes',
  vercel.includes('"schedule": "*/15 * * * *"'),
);

check(
  'Professional WhatsApp alert uses an approved template path, not free text',
  notification.includes('WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_NAME') &&
    notification.includes('sendWhatsAppTemplate') &&
    !notification.includes('sendWhatsAppTextMessage'),
);

check(
  'TurnIA settings expose non-secret WhatsApp diagnostics',
  settings.includes('getWhatsAppIntegrationStatus') &&
    settings.includes('Recordatorio 24 h') &&
    settings.includes('Graph API:'),
);

check(
  'Professional phone is normalized before saving',
  settingsActions.includes('normalizePhone(parsed.data.professional_phone)') &&
    settingsActions.includes('professionalPhoneE164'),
);

check(
  'Professional notification contacts are keyed per tenant and user',
  professionalContactsMigration.includes('primary key (tenant_id, user_id)') &&
    professionalContactsMigration.includes('user_id = auth.uid()'),
);

check(
  'Reprogram alerts target the assigned professional contact first',
  notification.includes('appointment.professional_id') &&
    notification.includes("from('professional_contacts')") &&
    notification.includes("eq('user_id', appointment.professional_id)"),
);

check(
  'Immediate and webhook failures track failed_at',
  created.includes('failed_at: new Date().toISOString()') &&
    webhook.includes('patch.failed_at') &&
    reminder.includes('failed_at: params.ok ? null : new Date().toISOString()') &&
    notification.includes('failed_at: params.ok ? null : new Date().toISOString()'),
);

check(
  'Repeated pending reprogram clicks are idempotent',
  idempotentRescheduleMigration.includes("return query select 'already_requested'::text") &&
    idempotentRescheduleMigration.includes('a.reschedule_requested_at is null') &&
    publicToken.includes("result === 'ok' || result === 'already_requested'"),
);

check(
  'Post-migration professional alerts never fall back to another professional contact',
  notification.includes('professionalContactTableUnavailable') &&
    notification.includes("professionalContactError?.code === 'PGRST205'"),
);

check(
  'Agenda delivery badges only summarize patient-facing messages',
  agendaPage.includes(".in('message_type', ['appointment_created', 'appointment_reminder_24h'])"),
);

console.log(`WhatsApp regression: ${passes.length} PASS / ${failures.length} FAIL`);
for (const name of passes) console.log(`PASS ${name}`);
for (const failure of failures) console.error(`FAIL ${failure}`);

if (failures.length) process.exit(1);
