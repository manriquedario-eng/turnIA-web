// Validaciones del PDF firmado subido por el profesional (PARTE F del
// pedido), ANTES de tocar Storage. Deliberadamente mínimas: sin parseo ni
// ejecución de PDF, sin validación PKI — sólo magic bytes y tamaño. Sin
// ningún import (funciones puras) para poder testearlas aisladas.

/** Mismo límite que file_size_limit=20971520 del bucket patient-documents (20 MB en bytes). */
export const MAX_SIGNED_PDF_BYTES = 20 * 1024 * 1024;

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/** Primeros 5 bytes exactamente "%PDF-" — ninguna inspección más profunda del contenido. */
export function isPdfMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < PDF_MAGIC.length) return false;
  return buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

export function isWithinMaxSignedSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_SIGNED_PDF_BYTES;
}
