import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixDocumentStateRequest,
  DigilogixDocumentStateResponse,
  DigilogixSignDocumentRequest,
  DigilogixSignDocumentsRequest,
  DigilogixSignResponse,
} from './types';

export function requestDocumentSignature(body: DigilogixSignDocumentRequest) {
  return digilogixPost<DigilogixSignResponse>(
    '/FirmaDigital/PostFirmarDocumentoFirmaDigital',
    body,
  );
}

export function requestDocumentsSignature(body: DigilogixSignDocumentsRequest) {
  return digilogixPost<DigilogixSignResponse>(
    '/FirmaDigital/PostFirmarDocumentosFirmaDigital',
    body,
  );
}

export function getDocumentSignatureState(IdentificadorDocumento: string) {
  const body: DigilogixDocumentStateRequest = { IdentificadorDocumento };
  return digilogixPost<DigilogixDocumentStateResponse>(
    '/FirmaDigital/PostObtenerEstadoFirmaDigitalDocumento',
    body,
  );
}
