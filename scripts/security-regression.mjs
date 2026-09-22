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

console.log(`Security regression: ${passes.length} PASS / ${failures.length} FAIL`);
for (const name of passes) console.log(`PASS ${name}`);
for (const failure of failures) console.error(`FAIL ${failure}`);

if (failures.length) process.exit(1);
