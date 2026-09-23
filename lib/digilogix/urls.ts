import 'server-only';

function getAppUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (!configured) throw new Error('app_url_not_configured');
  return configured.replace(/\/+$/, '');
}

export type DigilogixReturnUrls = {
  ok: string;
  error: string;
  rejected: string;
};

export function getDigilogixOnboardingReturnUrls(): DigilogixReturnUrls {
  const base = getAppUrl();
  return {
    ok: `${base}/api/integrations/digilogix/onboarding/callback/ok`,
    error: `${base}/api/integrations/digilogix/onboarding/callback/error`,
    rejected: `${base}/api/integrations/digilogix/onboarding/callback/rejected`,
  };
}

export function getDigilogixSigningReturnUrls(): DigilogixReturnUrls {
  const base = getAppUrl();
  return {
    ok: `${base}/api/integrations/digilogix/signing/callback/ok`,
    error: `${base}/api/integrations/digilogix/signing/callback/error`,
    rejected: `${base}/api/integrations/digilogix/signing/callback/rejected`,
  };
}
