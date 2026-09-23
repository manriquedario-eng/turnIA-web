import type {
  DigilogixDocumentStateResponse,
  DigilogixEnvelope,
  DigilogixSignResponse,
  DigilogixUploadedDocumentResult,
} from './types';

export function isDigilogixSuccess(envelope: DigilogixEnvelope<unknown>): boolean {
  return Number.isInteger(envelope.CodigoResultado) && envelope.CodigoResultado === 0;
}

/**
 * La documentación todavía no define expresamente qué valor representa
 * éxito en CodigoResultado. La función anterior asume 0 como convención
 * habitual, pero NO se usa para descartar respuestas todavía.
 *
 * Hasta confirmarlo con una respuesta real o documentación adicional,
 * este helper sólo valida la forma mínima del sobre.
 */
export function hasValidDigilogixEnvelope(value: unknown): value is DigilogixEnvelope<unknown> {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.CodigoResultado === 'number'
    && typeof obj.MensajeResultado === 'string';
}

export function firstUploadedDocument(
  response: DigilogixSignResponse,
): DigilogixUploadedDocumentResult | null {
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
  return response.Datos?.CodigoEstado === 3;
}

export function hasRejectedSigner(response: DigilogixDocumentStateResponse): boolean {
  return response.Datos?.Estados?.some((state) => state.CodigoEstado === 5) ?? false;
}

export function hasSignerError(response: DigilogixDocumentStateResponse): boolean {
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
