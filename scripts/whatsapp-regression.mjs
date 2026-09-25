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
const finalActionCleanupMigration = read('supabase/migrations/20260923190500_clear_pending_reschedule_on_final_action.sql');
const correctivePublicActionMigration = read('supabase/migrations/20260924121000_whatsapp_public_action_rpc_consistency.sql');
const whatsappPermissionsMigration = read('supabase/migrations/20260924122000_whatsapp_permissions_and_indexes.sql');
const appointmentMessagesServiceRoleMigration = read('supabase/migrations/20260924204500_whatsapp_appointment_messages_service_role_grants.sql');

const confirmRpcBlock = finalActionCleanupMigration.slice(
  finalActionCleanupMigration.indexOf('create or replace function public.confirm_public_appointment'),
  finalActionCleanupMigration.indexOf('create or replace function public.cancel_public_appointment'),
);
const cancelRpcBlock = finalActionCleanupMigration.slice(
  finalActionCleanupMigration.indexOf('create or replace function public.cancel_public_appointment'),
);
const publicToken = read('lib/appointments/public-token.ts');
const agendaPage = read('app/(protected)/agenda/page.tsx');
const paymentOffer = read('lib/mercadopago/payment-offer.ts');
const paymentRoute = read('app/api/payments/appointment/[token]/route.ts');
const mercadoPagoOrders = read('lib/mercadopago/orders.ts');
const actionExpiryMigration = read('supabase/migrations/20260924212000_public_appointment_actions_expire_at_start.sql');
const cancellationSideEffects = read('lib/appointments/cancellation-side-effects.ts');
const agendaActions = read('app/(protected)/agenda/actions.ts');
const publicAppointmentPage = read('app/t/[token]/page.tsx');
const publicPaymentPage = read('app/pagar/[token]/page.tsx');
const requestIp = read('lib/request-ip.ts');
const mercadoPagoReconcile = read('lib/mercadopago/reconcile.ts');
const mercadoPagoBalanceGuardMigration = read('supabase/migrations/20260924214500_mercadopago_reconciliation_balance_guard.sql');

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
  'Empty WhatsApp template body parameters are blocked before Meta',
  provider.includes('normalizedBodyParams') &&
    provider.includes('parámetro BODY vacío') &&
    provider.includes("params.templateName || process.env.WHATSAPP_TEMPLATE_NAME)?.trim()"),
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
  'Webhook rejects oversized payloads before processing',
  webhook.includes('MAX_WEBHOOK_BODY_BYTES') &&
    webhook.includes("status: 413") &&
    webhook.includes("Buffer.byteLength(rawBody, 'utf8')"),
);

check(
  'Webhook requires exact expected Phone Number ID',
  webhook.includes('WHATSAPP_PHONE_NUMBER_ID') &&
    webhook.includes("!expectedPhoneNumberId") &&
    webhook.includes('value.metadata?.phone_number_id !== expectedPhoneNumberId'),
);

check(
  'Initial appointment WhatsApp is informational and has no actions',
  !created.includes('quickReplyPayloads') &&
    !created.includes('turnia:appointment:${publicToken}:confirm') &&
    !created.includes('turnia:appointment:${publicToken}:cancel') &&
    !created.includes('turnia:appointment:${publicToken}:reschedule'),
);

check(
  'Reminder button payloads are namespaced and token-bound',
  reminder.includes('turnia:appointment:${params.publicToken}:confirm') &&
    reminder.includes('turnia:appointment:${params.publicToken}:cancel') &&
    reminder.includes('turnia:appointment:${params.publicToken}:reschedule'),
);

check(
  'WhatsApp actions require sender to match patient phone',
  actions.includes('senderDigits !== patientDigits') &&
    actions.includes("error_message: 'sender_mismatch'"),
);

check(
  'WhatsApp actions require exact Meta context bound to the sent reminder',
  actions.includes('if (!input.contextMessageId)') &&
    actions.includes("eq('provider_message_id', input.contextMessageId)") &&
    actions.includes("eq('appointment_id', appointment.id)") &&
    actions.includes('const outboundMessageId = contextMessage.id'),
);

check(
  'WhatsApp button context is limited to patient appointment messages',
  actions.includes("new Set(['appointment_reminder_24h'])") &&
    actions.includes('allowedContextTypes.has(contextMessage.message_type)'),
);

check(
  'Transient action ledger DB failures are retryable',
  actions.includes('if (eventInsertError)') &&
    actions.includes('throw eventInsertError'),
);

check(
  'Reminder processing counts fulfilled channel failures',
  reminder.includes("result.status === 'fulfilled' && result.value === false") &&
    reminder.includes('if (failedChannels > 0 || rejectedChannels > 0)'),
);

check(
  'Service role can access appointment message ledger for WhatsApp backend flows',
  appointmentMessagesServiceRoleMigration.includes('grant select, insert, update') &&
    appointmentMessagesServiceRoleMigration.includes('public.appointment_messages') &&
    appointmentMessagesServiceRoleMigration.includes('to service_role'),
);

check(
  'Public appointment mutations expire when the appointment starts',
  actionExpiryMigration.includes("a.starts_at > clock_timestamp()") &&
    actionExpiryMigration.includes('confirm_public_appointment') &&
    actionExpiryMigration.includes('cancel_public_appointment') &&
    actionExpiryMigration.includes('request_public_appointment_reschedule'),
);

check(
  'Cancelling an appointment never refunds or reverses recorded payments automatically',
  cancellationSideEffects.includes('NO devuelve ni revierte pagos') &&
    !cancellationSideEffects.includes("from('payments')") &&
    !cancellationSideEffects.includes("from('mercadopago_orders')") &&
    !cancellationSideEffects.includes("from('cash_movements')") &&
    !cancellationSideEffects.includes('createMercadoPagoRefund') &&
    !cancellationSideEffects.includes('refundMercadoPago'),
);

check(
  'Confirmed WhatsApp reply offers payment only when server-side eligibility passes',
  actions.includes('getMercadoPagoPaymentOfferByToken') &&
    actions.includes('if (offer.available)') &&
    actions.includes('https://www.turniahealth.com.ar/pagar/'),
);

check(
  'Appointment creation does not pre-create Mercado Pago checkout',
  agendaActions.includes('Mercado Pago NO se genera al crear el turno') &&
    agendaActions.includes('const paymentUrl: string | null = null') &&
    !agendaActions.includes('Error inesperado generando el checkout de Mercado Pago para el email'),
);

check(
  'Public payment offer requires confirmed future appointment with remaining balance',
  paymentOffer.includes("CONFIRMED_STATUSES") &&
    paymentOffer.includes("startsAt <= Date.now()") &&
    paymentOffer.includes("remainingAmount <= 0") &&
    paymentOffer.includes("mercadopago_connections"),
);

check(
  'Public payment offer blocks refund or chargeback review cases',
  paymentOffer.includes("reason: 'payment_review_required'") &&
    paymentOffer.includes("order.status === 'refunded'") &&
    paymentOffer.includes("order.status_detail === 'partially_refunded'"),
);

check(
  'Public payment route creates checkout only on explicit POST after eligibility recheck',
  paymentRoute.includes('export async function POST') &&
    paymentRoute.includes('getMercadoPagoPaymentOfferByToken') &&
    paymentRoute.includes('createMercadoPagoCheckoutForAppointment') &&
    !paymentRoute.includes('export async function GET'),
);

check(
  'Public payment initiation has cross-site and persistent rate-limit guards',
  paymentRoute.includes("!origin") &&
    paymentRoute.includes("origin !== request.nextUrl.origin") &&
    paymentRoute.includes("fetchSite === 'cross-site'") &&
    paymentRoute.includes("scope: 'public-payment-token'") &&
    paymentRoute.includes("scope: 'public-payment-ip'") &&
    paymentRoute.includes('checkRateLimit'),
);

check(
  'Public token pages are noindex and suppress referrer leakage',
  publicAppointmentPage.includes("index: false") &&
    publicAppointmentPage.includes("follow: false") &&
    publicAppointmentPage.includes("referrer: 'no-referrer'") &&
    publicPaymentPage.includes("index: false") &&
    publicPaymentPage.includes("follow: false") &&
    publicPaymentPage.includes("referrer: 'no-referrer'"),
);

check(
  'Rate-limit client IP prefers Vercel header when a proxy is in front',
  requestIp.includes("x-vercel-forwarded-for") &&
    requestIp.includes("x-forwarded-for") &&
    requestIp.indexOf("x-vercel-forwarded-for") < requestIp.lastIndexOf("x-forwarded-for"),
);

check(
  'External Mercado Pago redirect suppresses appointment token referrer',
  paymentRoute.includes("Referrer-Policy") &&
    paymentRoute.includes("no-referrer"),
);

check(
  'Mercado Pago checkout charges remaining balance and avoids stale reusable amounts',
  mercadoPagoOrders.includes("from('payments')") &&
    mercadoPagoOrders.includes('totalAmount - paidAmount') &&
    mercadoPagoOrders.includes("fail('already_paid'") &&
    mercadoPagoOrders.includes('Math.abs(orderAmount - amount) < 0.005'),
);

check(
  'Mercado Pago reconciliation rechecks remaining balance before recording payment',
  mercadoPagoBalanceGuardMigration.includes('payment_exceeds_remaining_balance') &&
    mercadoPagoBalanceGuardMigration.includes('v_paid_amount + v_order.amount') &&
    mercadoPagoBalanceGuardMigration.includes('grant execute on function public.record_mercadopago_payment') &&
    mercadoPagoBalanceGuardMigration.includes('to service_role'),
);

check(
  'Mercado Pago balance conflicts are classified as non-transient review cases',
  mercadoPagoReconcile.includes("reason: 'payment_review_required'") &&
    mercadoPagoReconcile.includes("rpcReason === 'payment_exceeds_remaining_balance'") &&
    mercadoPagoReconcile.includes("rpcReason === 'appointment_amount_unavailable'") &&
    mercadoPagoReconcile.includes('transient: false'),
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
  'Provider message IDs are unique for deterministic webhook status updates',
  migration.includes('appointment_messages_provider_message_id_unique') &&
    migration.includes('where provider_message_id is not null'),
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
  'Failed reminder and professional retries use an atomic claim',
  reminder.includes("const { data: claimedRetry, error: retryError }") &&
    reminder.includes(".eq('status', 'failed')") &&
    reminder.includes(".select('id')") &&
    reminder.includes('.maybeSingle()') &&
    reminder.includes('if (claimedRetry?.id)') &&
    notification.includes("const { data: claimedRetry, error: retryError }") &&
    notification.includes(".eq('status', 'failed')") &&
    notification.includes(".select('id')") &&
    notification.includes('.maybeSingle()') &&
    notification.includes('if (claimedRetry?.id)'),
);

check(
  'Unexpected provider exceptions are converted into retryable failed rows',
  reminder.includes('Error inesperado al enviar el recordatorio por email.') &&
    reminder.includes('Error inesperado al enviar el recordatorio por WhatsApp.') &&
    reminder.includes('throw error;') &&
    notification.includes('Error inesperado al enviar el aviso por email.') &&
    notification.includes('Error inesperado al enviar el aviso por WhatsApp.') &&
    notification.includes('Professional reschedule email failed') &&
    notification.includes('Professional reschedule WhatsApp failed'),
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
  '24h reminder scan uses stable pagination and isolates channel failures',
  reminder.includes('REMINDER_PAGE_SIZE = 200') &&
    reminder.includes(".order('starts_at', { ascending: true })") &&
    reminder.includes(".order('id', { ascending: true })") &&
    reminder.includes('.range(from, from + REMINDER_PAGE_SIZE - 1)') &&
    reminder.includes('Promise.allSettled') &&
    reminder.includes('rejectedChannels') &&
    cronRoute.includes('errors: result.errors') &&
    cronRoute.includes('pages: result.pages'),
);

check(
  'Professional WhatsApp alert uses an approved template path, not free text',
  notification.includes('WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_NAME') &&
    notification.includes('WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_NAME?.trim()') &&
    notification.includes('bodyParams: [professionalName, patientName, dateLabel, timeLabel]') &&
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
  'WhatsApp backend tables grant required service-role access',
  whatsappPermissionsMigration.includes('grant select, insert, update on table public.whatsapp_inbound_events to service_role') &&
    whatsappPermissionsMigration.includes('grant select on table public.professional_contacts to service_role'),
);

check(
  'WhatsApp follow-up covers FK indexes and RLS init-plan optimization',
  whatsappPermissionsMigration.includes('whatsapp_inbound_events_tenant_idx') &&
    whatsappPermissionsMigration.includes('whatsapp_inbound_events_patient_idx') &&
    whatsappPermissionsMigration.includes('professional_contacts_user_idx') &&
    whatsappPermissionsMigration.includes('user_id = (select auth.uid())'),
);

check(
  'Legacy professional contact backfill only runs for single-member tenants',
  professionalContactsMigration.includes('having count(*) = 1') &&
    professionalContactsMigration.includes('Multi-professional tenants are') &&
    professionalContactsMigration.includes('on conflict (tenant_id, user_id) do nothing'),
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

const requestRescheduleFunction = publicToken.slice(
  publicToken.indexOf('export async function requestRescheduleByToken'),
);

check(
  'Repeated pending reprogram clicks are idempotent',
  idempotentRescheduleMigration.includes("return query select 'already_requested'::text") &&
    idempotentRescheduleMigration.includes('a.reschedule_requested_at is null') &&
    requestRescheduleFunction.includes("result === 'ok' || result === 'already_requested'"),
);

check(
  'Confirm and cancel clear pending reprogram metadata',
  finalActionCleanupMigration.includes("status = 'confirmed'") &&
    finalActionCleanupMigration.includes("status = 'cancelled'") &&
    (finalActionCleanupMigration.match(/reschedule_requested_at = null/g) ?? []).length >= 2 &&
    (finalActionCleanupMigration.match(/reschedule_note = null/g) ?? []).length >= 2,
);

check(
  'Public action RPC result semantics are not crossed',
  confirmRpcBlock.includes("return query select 'ok'::text;") &&
    confirmRpcBlock.includes("return query select 'already_cancelled'::text;") &&
    cancelRpcBlock.includes("if v_status in ('cancelled', 'cancelado') then") &&
    cancelRpcBlock.includes("return query select 'already_cancelled'::text;") &&
    cancelRpcBlock.includes("return query select 'ok'::text;") &&
    correctivePublicActionMigration.includes("return query select 'already_cancelled'::text;") &&
    publicToken.includes("if (result === 'already_cancelled')"),
);

check(
  'Professional contact backfill validates complete E.164 values',
  professionalContactsMigration.includes("[0-9]{7,14}$'") &&
    professionalContactsMigration.includes("professional_phone"),
);

check(
  'Completed appointments cannot be mutated from public or WhatsApp actions',
  finalActionCleanupMigration.includes("v_status in ('completed', 'completado')") &&
    idempotentRescheduleMigration.includes("v_status in ('completed', 'completado')"),
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
