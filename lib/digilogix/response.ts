import type {
  DigilogixCertificateResponse,
  DigilogixCommonResultCode,
  DigilogixDocumentStateResponse,
  DigilogixEnvelope,
  DigilogixSignResponse,
  DigilogixUploadedDocumentResult,
} from './types';

export function hasValidDigilogixEnvelope(value: unknown): value is DigilogixEnvelope<unknown> {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.CodigoResultado === 'number'
    && typeof obj.MensajeResultado === 'string';
}

export function commonResultMeaning(code: number): string {
  switch (code) {
    case -2:
      return 'Los parámetros no son válidos';
    case -1:
      return 'No se autorizó el uso del método';
    case 0:
      return 'Se produjo un error';
    case 1:
      return 'Proceso completado correctamente';
    default:
      return 'Código de resultado no documentado';
  }
}

export function isCommonSuccessCode(code: number): code is Extract<DigilogixCommonResultCode, 1> {
  return code === 1;
}

export function documentStateResultMeaning(code: number): string {
  switch (code) {
    case -2:
      return 'Los parámetros no son válidos';
    case -1:
      return 'No se autorizó el uso del método';
    case 0:
      return 'Se produjo un error';
    case 1:
      return 'Estados obtenidos';
    case 2:
      return 'Identificador de documento inválido';
    case 3:
      return 'No se pudo obtener el archivo';
    default:
      return 'Código de resultado no documentado';
  }
}

export function certificateResultMeaning(code: number): string {
  switch (code) {
    case -2:
      return 'Los parámetros no son válidos';
    case -1:
      return 'No se autorizó el uso del método';
    case 0:
      return 'Se produjo un error';
    case 1:
      return 'Certificado obtenido';
    case 2:
      return 'La persona no posee un certificado';
    case 3:
      return 'La persona no posee un certificado vigente';
    default:
      return 'Código de resultado no documentado';
  }
}

export function isDocumentStateQuerySuccessful(
  response: DigilogixDocumentStateResponse,
): boolean {
  return response.CodigoResultado === 1 && Boolean(response.Datos);
}

export function isCertificateAvailable(
  response: DigilogixCertificateResponse,
): boolean {
  return response.CodigoResultado === 1 && Boolean(response.Datos?.CertificadoDerBase64);
}

export function certificateNeedsOnboardingOrRenewal(
  response: DigilogixCertificateResponse,
): boolean {
  return response.CodigoResultado === 2 || response.CodigoResultado === 3;
}

export function firstUploadedDocument(
  response: DigilogixSignResponse,
): DigilogixUploadedDocumentResult | null {
  if (response.CodigoResultado !== 1) return null;
  const first = response.Datos?.Resultados?.[0];
  if (!first?.IdentificadorDocumento || !Array.isArray(first.Autorizaciones)) return null;
  return first;
}

export function firstAuthorizationUrl(response: DigilogixSignResponse): string | null {
  const document = firstUploadedDocument(response);
  const url = document?.Autorizaciones?.[0]?.URLAutorizacion;
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isFullySigned(response: DigilogixDocumentStateResponse): boolean {
  return isDocumentStateQuerySuccessful(response) && response.Datos?.CodigoEstado === 3;
}

export function hasRejectedSigner(response: DigilogixDocumentStateResponse): boolean {
  if (!isDocumentStateQuerySuccessful(response)) return false;
  return response.Datos?.Estados?.some((state) => state.CodigoEstado === 5) ?? false;
}

export function hasSignerError(response: DigilogixDocumentStateResponse): boolean {
  if (!isDocumentStateQuerySuccessful(response)) return false;
  return response.Datos?.Estados?.some((state) => state.CodigoEstado === 6) ?? false;
}

export function signedPdfBuffer(response: DigilogixDocumentStateResponse): Buffer | null {
  if (!isFullySigned(response)) return null;
  const base64 = response.Datos?.ArchivoFirmadoBase64;
  if (!base64) return null;

  try {
    const buffer = Buffer.from(base64, 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}
