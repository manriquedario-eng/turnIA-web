import 'server-only';

import { buildDigilogixAuthorizationToken } from './auth';
import {
  areDigilogixLiveCallsEnabled,
  getDigilogixConfig,
} from './config';
import type { DigilogixApiResult } from './types';

function safeProviderMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['message', 'Message', 'mensaje', 'Mensaje', 'detail', 'Detalle', 'error', 'Error']) {
      const candidate = obj[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 500);
    }
  }
  return fallback;
}

export async function digilogixPost<T>(
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<DigilogixApiResult<T>> {
  if (!areDigilogixLiveCallsEnabled()) {
    return {
      ok: false,
      reason: 'disabled',
      errorMessage: 'Las llamadas reales a Digilogix están deshabilitadas en este entorno.',
    };
  }

  const config = getDigilogixConfig();
  if (!config) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'La integración Digilogix todavía no está configurada.',
    };
  }

  let token: string;
  try {
    token = buildDigilogixAuthorizationToken(config);
  } catch {
    return {
      ok: false,
      reason: 'invalid_configuration',
      errorMessage: 'La configuración criptográfica de Digilogix no es válida.',
    };
  }

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: token,
        IdentificadorUsuario: config.userIdentifier,
      },
      body: JSON.stringify(body),
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
        errorMessage: safeProviderMessage(parsed, `Digilogix respondió ${response.status}`),
        status: response.status,
      };
    }

    if (parsed === null) {
      return {
        ok: false,
        reason: 'invalid_response',
        errorMessage: 'Digilogix respondió sin contenido.',
        status: response.status,
      };
    }

    return { ok: true, data: parsed as T, status: response.status };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      reason: 'network_error',
      errorMessage: isAbort
        ? 'Digilogix no respondió dentro del tiempo esperado.'
        : 'No se pudo conectar con Digilogix.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
