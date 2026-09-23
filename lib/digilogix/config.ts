import 'server-only';

export type DigilogixConfig = {
  baseUrl: string;
  authLogin: string;
  authClient: string;
  authPassword: string;
  privateKey: string;
  salt: string;
  iv: string;
  userIdentifier: string;
  companyId: string | null;
  authTimeZone: string;
};

const DEFAULT_TEST_BASE_URL = 'https://test.api.firmador.digilogix.com.ar/api';
const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export function isDigilogixFeatureVisible(): boolean {
  return process.env.DIGILOGIX_FEATURE_VISIBLE === 'true';
}

/**
 * Segundo bloqueo deliberado: aunque todas las credenciales estén cargadas,
 * no se permite tráfico real hacia Digilogix hasta habilitar explícitamente
 * esta bandera en el entorno de preview/homologación.
 */
export function areDigilogixLiveCallsEnabled(): boolean {
  return process.env.DIGILOGIX_LIVE_CALLS_ENABLED === 'true';
}

export function getDigilogixConfig(): DigilogixConfig | null {
  const authLogin = process.env.DIGILOGIX_AUTH_LOGIN?.trim();
  const authClient = process.env.DIGILOGIX_AUTH_CLIENT?.trim();
  const authPassword = process.env.DIGILOGIX_AUTH_PASSWORD?.trim();
  const privateKey = process.env.DIGILOGIX_PRIVATE_KEY?.trim();
  const salt = process.env.DIGILOGIX_SALT?.trim();
  const iv = process.env.DIGILOGIX_IV?.trim();
  const userIdentifier = process.env.DIGILOGIX_USER_IDENTIFIER?.trim();

  if (!authLogin || !authClient || !authPassword || !privateKey || !salt || !iv || !userIdentifier) {
    return null;
  }

  return {
    baseUrl: (process.env.DIGILOGIX_BASE_URL?.trim() || DEFAULT_TEST_BASE_URL).replace(/\/+$/, ''),
    authLogin,
    authClient,
    authPassword,
    privateKey,
    salt,
    iv,
    userIdentifier,
    companyId: process.env.DIGILOGIX_COMPANY_ID?.trim() || null,
    authTimeZone: process.env.DIGILOGIX_AUTH_TIMEZONE?.trim() || DEFAULT_TIME_ZONE,
  };
}
