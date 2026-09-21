import 'server-only';

import type { MisRxApiResult } from './types';

const DEFAULT_BASE_URL = 'https://misrx.com.ar/wsmvd';

function getBaseUrl(): string {
  const configured = process.env.MISRX_BASE_URL?.trim();
  return (configured || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function safeProviderMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['message', 'detail', 'descripcion', 'data']) {
      const candidate = obj[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().slice(0, 500);
      }
    }
  }
  return fallback;
}

export async function misRxRequest<T>(params: {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accessToken?: string;
  appId?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  form?: URLSearchParams;
  timeoutMs?: number;
}): Promise<MisRxApiResult<T>> {
  const url = new URL(`${getBaseUrl()}${params.path.startsWith('/') ? params.path : `/${params.path}`}`);

  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const headers = new Headers({ Accept: 'application/json' });
  if (params.accessToken) headers.set('Authorization', `Bearer ${params.accessToken}`);
  if (params.appId) headers.set('AppID', params.appId);

  let body: BodyInit | undefined;
  if (params.form) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    body = params.form.toString();
  } else if (params.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(params.body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);

  try {
    const response = await fetch(url, {
      method: params.method ?? 'GET',
      headers,
      body,
      cache: 'no-store',
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'provider_error',
        errorMessage: safeProviderMessage(parsed, `MisRX respondió ${response.status}`),
        status: response.status,
      };
    }

    return { ok: true, data: parsed as T };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      reason: 'network_error',
      errorMessage: isAbort ? 'MisRX no respondió dentro del tiempo esperado.' : 'No se pudo conectar con MisRX.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
