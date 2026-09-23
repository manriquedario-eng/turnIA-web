import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixCertificateRequest,
  DigilogixUnknownResponse,
  DigilogixVerifyHashRequest,
} from './types';

export function getDigilogixCertificate(body: DigilogixCertificateRequest) {
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostObtenerCertificado',
    body,
  );
}

export function verifyDigilogixSignedHash(body: DigilogixVerifyHashRequest) {
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostVerificarFirmaHash',
    body,
  );
}
