import 'server-only';

import { misRxRequest } from './client';
import type { MisRxApiResult, MisRxLoginResponse } from './types';

export async function loginToMisRx(params: {
  username: string;
  password: string;
  verifyExp?: boolean;
}): Promise<MisRxApiResult<MisRxLoginResponse>> {
  const username = params.username.trim();
  const password = params.password;

  if (!username || !password) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'Faltan las credenciales de MisRX.',
    };
  }

  const result = await misRxRequest<MisRxLoginResponse>({
    path: '/login',
    method: 'POST',
    query: { verify_exp: params.verifyExp ?? false },
    form: new URLSearchParams({
      grant_type: 'password',
      username,
      password,
      scope: '',
      client_id: '',
      client_secret: '',
    }),
  });

  if (!result.ok) return result;
  if (!result.data?.access_token || !result.data?.token_type) {
    return {
      ok: false,
      reason: 'invalid_response',
      errorMessage: 'MisRX respondió sin un token de acceso válido.',
    };
  }

  return result;
}
