// SHA-256 de archivos de documentos (Fase 1 de firma digital externa).
// Sólo sirve para verificar integridad del archivo subido (detectar si
// cambió después de subido) — NO es una firma digital ni prueba autoría
// (ver comentarios de original_sha256/signed_sha256 en la migración).
//
// Usa exclusivamente el módulo `crypto` de Node (ya presente en el
// runtime, PARTE B del pedido: "no agregar librerías nuevas") — nunca el
// `crypto` global del navegador/Edge, por eso este archivo también asume
// runtime Node (mismo criterio que lib/export/pdf/render.ts).

import { createHash } from 'crypto';

/** Hex en minúsculas, 64 caracteres — mismo formato que exige el CHECK de patient_documents.*_sha256. */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
