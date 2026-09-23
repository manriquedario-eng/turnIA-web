import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixCertificateRequest,
  DigilogixCertificateResponse,
  DigilogixVerifyHashRequest,
  DigilogixVerifyHashResponse,
} from './types';

export function getDigilogixCertificate(body: DigilogixCertificateRequest) {
  return digilogixPost<DigilogixCertificateResponse>(
    '/FirmaDigital/PostObtenerCertificado',
    body,
  );
}

export function verifyDigilogixSignedHash(body: DigilogixVerifyHashRequest) {
  return digilogixPost<DigilogixVerifyHashResponse>(
    '/FirmaDigital/PostVerificarFirmaHash',
    body,
  );
}
