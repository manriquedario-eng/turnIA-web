// Nombres de descarga (PARTE E/G del pedido): "TurnIA_<tipo>_v<version>.pdf"
// para el original y "TurnIA_<tipo>_firmado_v<version>.pdf" para el firmado
// — deliberadamente SIN el nombre del paciente (a diferencia de
// lib/export/filename.ts) y sin fecha, formato fijo pedido explícitamente.
//
// Reutiliza sanitizeFilenamePart de lib/export/filename.ts (PARTE A: "no
// dupliques lógica si ya existe una función segura reutilizable") como
// defensa en profundidad, aunque document_type ya es un valor fijo de la
// allowlist — así una futura etiqueta nueva nunca puede romper el nombre
// de archivo en Windows/mac/Linux.

import { sanitizeFilenamePart } from '@/lib/export/filename';
import type { DocumentType } from './types';

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  ficha_clinica: 'Ficha_Clinica',
  consentimiento_informado: 'Consentimiento_Informado',
  informe_clinico: 'Informe_Clinico',
  otro: 'Documento',
};

function labelFor(documentType: DocumentType): string {
  return sanitizeFilenamePart(DOCUMENT_TYPE_LABEL[documentType] ?? 'Documento');
}

export function buildOriginalDownloadFilename(documentType: DocumentType, version: number): string {
  return `TurnIA_${labelFor(documentType)}_v${version}.pdf`;
}

export function buildSignedDownloadFilename(documentType: DocumentType, version: number): string {
  return `TurnIA_${labelFor(documentType)}_firmado_v${version}.pdf`;
}
