import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixDocumentStateRequest,
  DigilogixSignDocumentRequest,
  DigilogixSignDocumentsRequest,
  DigilogixUnknownResponse,
} from './types';

export function requestDocumentSignature(body: DigilogixSignDocumentRequest) {
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostFirmarDocumentoFirmaDigital',
    body,
  );
}

export function requestDocumentsSignature(body: DigilogixSignDocumentsRequest) {
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostFirmarDocumentosFirmaDigital',
    body,
  );
}

export function getDocumentSignatureState(IdentificadorDocumento: string) {
  const body: DigilogixDocumentStateRequest = { IdentificadorDocumento };
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostObtenerEstadoFirmaDigitalDocumento',
    body,
  );
}
