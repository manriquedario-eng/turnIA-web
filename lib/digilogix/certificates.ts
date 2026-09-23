import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixCertificateRequest,
  DigilogixCertificateResponse,
  DigilogixSimpleResponse,
  DigilogixVerifyHashRequest,
} from './types';

export function getDigilogixCertificate(body: DigilogixCertificateRequest) {
  return digilogixPost<DigilogixCertificateResponse>(
    '/FirmaDigital/PostObtenerCertificado',
    body,
  );
}

export function verifyDigilogixSignedHash(body: DigilogixVerifyHashRequest) {
  return digilogixPost<DigilogixSimpleResponse>(
    '/FirmaDigital/PostVerificarFirmaHash',
    body,
  );
}
