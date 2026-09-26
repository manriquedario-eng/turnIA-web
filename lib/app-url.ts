const DEFAULT_PRODUCTION_APP_URL = 'https://www.turniahealth.com.ar';

const ALLOWED_PRODUCTION_APP_URLS = new Set([
  'https://www.turniahealth.com.ar',
  'https://app.turniahealth.com.ar',
]);

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/$/, '');
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicAppUrl(): string {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}`;
  }

  const configured = normalizeBaseUrl(process.env.APP_URL);

  if (process.env.VERCEL_ENV === 'production') {
    return configured && ALLOWED_PRODUCTION_APP_URLS.has(configured)
      ? configured
      : DEFAULT_PRODUCTION_APP_URL;
  }

  return configured ?? 'http://localhost:3000';
}

export function getGoogleRedirectUri(): string {
  return `${getPublicAppUrl()}/api/google/oauth/callback`;
}
