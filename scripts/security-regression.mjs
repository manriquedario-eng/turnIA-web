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

function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(rel) : [rel];
  });
}

const runtimeFiles = [...walk('app'), ...walk('lib'), 'middleware.ts'].filter((f) => fs.existsSync(path.join(root, f)));
const runtimeText = runtimeFiles.map((f) => `\n/* ${f} */\n${read(f)}`).join('\n');

// Browser-only checks must inspect code that can actually enter a client
// bundle. Server-only modules may legitimately mention storage concepts in
// comments or use the Supabase service role for protected integrations.
const clientRuntimeFiles = runtimeFiles.filter((f) => {
  const text = read(f);
  return /^\s*['"]use client['"];?/m.test(text);
});
const clientRuntimeText = clientRuntimeFiles.map((f) => `\n/* ${f} */\n${read(f)}`).join('\n');

check('No dangerouslySetInnerHTML in active runtime', !runtimeText.includes('dangerouslySetInnerHTML'));
check('No direct innerHTML writes in active runtime', !/\.innerHTML\s*=/.test(runtimeText));
check('No eval/new Function in active runtime', !/\beval\s*\(|new\s+Function\s*\(/.test(runtimeText));
check('No browser localStorage/sessionStorage auth state', !/\b(localStorage|sessionStorage)\b/.test(clientRuntimeText));
check(
  'No service-role secret referenced by browser runtime',
  !/SUPABASE_SERVICE_ROLE|service_role/i.test(clientRuntimeText) &&
    !/NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/i.test(runtimeText),
);
const transcriptionRoute = read('app/api/transcription/route.ts');
check('Transcription endpoint requires tenant auth', transcriptionRoute.includes('requireTenant'));
check('Transcription API key remains server-side', transcriptionRoute.includes('process.env.OPENAI_API_KEY') && !runtimeText.includes('NEXT_PUBLIC_OPENAI_API_KEY'));
check('Transcription validates audio size', transcriptionRoute.includes('MAX_AUDIO_BYTES') && transcriptionRoute.includes('audio.size'));
check('Transcription does not cache responses', transcriptionRoute.includes("cache: 'no-store'") || transcriptionRoute.includes("Cache-Control"));
check(
  'Transcription enforces five-minute dictation limit server-side',
  transcriptionRoute.includes('MAX_DICTATION_SECONDS = 5 * 60') &&
    transcriptionRoute.includes('durationSeconds > MAX_DICTATION_SECONDS'),
);
check(
  'Five-minute cap applies per recording, not to account consumption',
  transcriptionRoute.includes('normalizeDictationSeconds') &&
    !/Math\.min\(MAX_DICTATION_SECONDS/.test(transcriptionRoute),
);
const voiceTranscriptionUi = read('components/patients/VoiceTranscriptionTextarea.tsx');
check(
  'Voice dictation UI auto-stops at five minutes and explains intended use',
  voiceTranscriptionUi.includes('MAX_DICTATION_SECONDS = 5 * 60') &&
    voiceTranscriptionUi.includes('next >= MAX_DICTATION_SECONDS') &&
    voiceTranscriptionUi.includes('No está pensado para grabar sesiones ni conversaciones'),
);

const transcriptionCreditHardening = read('supabase/migrations/20260922010000_ai_transcription_credit_hardening.sql');
check(
  'Transcription balance columns are not directly updatable by authenticated',
  /revoke\s+update\s+on\s+table\s+public\.ai_transcription_accounts\s+from\s+authenticated/i.test(transcriptionCreditHardening) &&
    /grant\s+update\s*\(\s*enabled\s*,\s*updated_at\s*\)/i.test(transcriptionCreditHardening) &&
    !/grant\s+update\s*\([^)]*(balance_seconds|lifetime_used_seconds)/i.test(transcriptionCreditHardening),
);

const protectedActions = [
  'app/(protected)/patients/actions.ts',
  'app/(protected)/agenda/actions.ts',
  'app/(protected)/services/actions.ts',
  'app/(protected)/settings/actions.ts',
  'app/(protected)/payments/actions.ts',
  'app/(protected)/planning/actions.ts',
];
for (const file of protectedActions) {
  const text = read(file);
  check(`${file} uses requireTenant`, text.includes('requireTenant'));
}

const paymentActions = read('app/(protected)/payments/actions.ts');
check('Payments use atomic registration RPC', /rpc\(['\"]register_payment_with_cash['\"]/.test(paymentActions));
check('Payments action does not directly insert payment before cash', !/from\(['\"]payments['\"]\)\.insert/.test(paymentActions));
check('Payments validate input with Zod', paymentActions.includes("from 'zod'") || paymentActions.includes('from "zod"'));


const billingActions = read('app/(protected)/billing/actions.ts');
check(
  'Billing fiscal transitions use service role',
  billingActions.includes("createSupabaseServiceClient") &&
    /const\s+serviceClient\s*=\s*createSupabaseServiceClient\(\)/.test(billingActions) &&
    /serviceClient[\s\S]*from\(['"]billing_invoices['"]\)[\s\S]*status:\s*['"]authorizing['"]/.test(billingActions) &&
    /serviceClient[\s\S]*from\(['"]billing_invoices['"]\)[\s\S]*arca_cae/.test(billingActions),
);
const billingRlsMigration = read('supabase/migrations/20260922004500_billing_rls_hardening.sql');
check(
  'Billing authenticated role cannot UPDATE invoices directly',
  /revoke\s+update\s+on\s+table\s+public\.billing_invoices\s+from\s+authenticated/i.test(billingRlsMigration) &&
    !/create\s+policy\s+\w+[\s\S]{0,160}on\s+public\.billing_invoices[\s\S]{0,120}for\s+update/i.test(billingRlsMigration),
);
check(
  'Billing invoice detail is immutable after draft',
  /revoke\s+update\s+on\s+table\s+public\.billing_invoice_lines\s+from\s+authenticated/i.test(billingRlsMigration) &&
    /revoke\s+update\s+on\s+table\s+public\.billing_invoice_appointments\s+from\s+authenticated/i.test(billingRlsMigration),
);

const patientDetail = read('app/(protected)/patients/[id]/page.tsx');
check('Patient detail requires tenant context', patientDetail.includes('requireTenant'));
check('Patient detail filters patient by tenant', /from\(['\"]patients['\"]\)[\s\S]*?eq\(['\"]tenant_id['\"],\s*tenantId\)/.test(patientDetail));

const searchPage = read('app/(protected)/search/page.tsx');
check('Global search requires tenant context', searchPage.includes('requireTenant'));
check('Global search applies tenant filtering', searchPage.includes("eq('tenant_id', tenantId)") || searchPage.includes('eq("tenant_id", tenantId)'));

const tenantGuard = read('lib/auth/require-user.ts');
check('Tenant context resolves from authenticated user', tenantGuard.includes(".eq('user_id', user.id)") || tenantGuard.includes('.eq("user_id", user.id)'));
check('Protected auth verifies current user server-side', tenantGuard.includes('supabase.auth.getUser()'));

// ---------------------------------------------------------------------------
// Regression coverage for production-audit fixes.
// These checks intentionally cover only general TurnIA safeguards. WhatsApp,
// MisRX and digital-signature/Digilogix branches remain outside this audit.
// ---------------------------------------------------------------------------

const patientContactUniqueness = read('supabase/migrations/20260924014000_patients_unique_active_contacts.sql');
check(
  'Active patient phone/email uniqueness remains enforced per tenant',
  patientContactUniqueness.includes('patients_tenant_phone_e164_unique') &&
    patientContactUniqueness.includes('patients_tenant_email_norm_unique') &&
    patientContactUniqueness.includes('where deleted_at is null and phone_e164 is not null') &&
    patientContactUniqueness.includes('where deleted_at is null and email is not null'),
);

const reimbursementUniqueness = read('supabase/migrations/20260923222000_reimbursement_appointment_global_uniqueness.sql');
check(
  'A reimbursement appointment cannot be reused across cases',
  /unique\s*\(\s*appointment_id\s*\)/i.test(reimbursementUniqueness),
);

const overlapProtection = read('supabase/migrations/20260917182646_prevent_overlapping_appointments.sql');
check(
  'Appointment overlap protection remains enforced in the database',
  overlapProtection.includes('appointments_no_overlap') &&
    /exclude\s+using\s+gist/i.test(overlapProtection) &&
    overlapProtection.includes("tstzrange(starts_at, ends_at, '[)') with &&"),
);

const manualPaymentGuard = read('supabase/migrations/20260924015500_manual_payment_balance_guard.sql');
check(
  'Manual payment RPC serializes and blocks overpayment',
  /for\s+update\s+of\s+a/i.test(manualPaymentGuard) &&
    manualPaymentGuard.includes('payment_exceeds_remaining_balance') &&
    /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.payments\s+from\s+authenticated/i.test(manualPaymentGuard),
);

const patientActionsForLocking = read('app/(protected)/patients/actions.ts');
check(
  'Patient edits use optimistic locking',
  patientActionsForLocking.includes("formData.get('expected_updated_at')") &&
    patientActionsForLocking.includes(".eq('updated_at', expectedUpdatedAt.data)"),
);

const appointmentActionsForLocking = read('app/(protected)/agenda/actions.ts');
check(
  'Appointment edits use optimistic locking',
  appointmentActionsForLocking.includes("formData.get('expected_updated_at')") &&
    appointmentActionsForLocking.includes(".eq('updated_at', expectedUpdatedAt.data)"),
);

const cancellationEffects = read('lib/appointments/cancellation-side-effects.ts');
check(
  'Appointment cancellation keeps Google and email side effects isolated',
  cancellationEffects.includes('cancelGoogleMeetForAppointment') &&
    cancellationEffects.includes('sendAppointmentCancellationEmail') &&
    cancellationEffects.includes('try {') &&
    cancellationEffects.includes('externalCalendarEventId'),
);

const arcaBillingActions = read('app/(protected)/billing/actions.ts');
const arcaWsfe = read('lib/arca/wsfe.ts');
check(
  'ARCA invoices can be reconciled without reissuing a lost CAE',
  arcaBillingActions.includes('reconcileBillingInvoice') &&
    arcaBillingActions.includes('getWsfeInvoiceByNumber') &&
    arcaBillingActions.includes('arca_voucher_number') &&
    arcaWsfe.includes('FECompConsultar'),
);

const googleCalendar = read('lib/google/calendar.ts');
const emailProvider = read('lib/email/provider.ts');
check(
  'Google and email provider requests have explicit timeouts',
  googleCalendar.includes('GOOGLE_REQUEST_TIMEOUT_MS') &&
    googleCalendar.includes('AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)') &&
    emailProvider.includes('EMAIL_REQUEST_TIMEOUT_MS') &&
    emailProvider.includes('AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS)'),
);

const exportAuthorize = read('lib/export/authorize.ts');
check(
  'Patient and payments exports paginate instead of silently truncating',
  exportAuthorize.includes('PATIENTS_EXPORT_PAGE_SIZE') &&
    exportAuthorize.includes('PatientsExportTooLargeError') &&
    exportAuthorize.includes('PAYMENTS_EXPORT_PAGE_SIZE') &&
    exportAuthorize.includes('PaymentsExportTooLargeError') &&
    exportAuthorize.includes('.range(offset, offset + PATIENTS_EXPORT_PAGE_SIZE - 1)') &&
    exportAuthorize.includes('.range(offset, offset + PAYMENTS_EXPORT_PAGE_SIZE - 1)'),
);

console.log(`Security regression: ${passes.length} PASS / ${failures.length} FAIL`);
for (const name of passes) console.log(`PASS ${name}`);
for (const failure of failures) console.error(`FAIL ${failure}`);

if (failures.length) process.exit(1);
