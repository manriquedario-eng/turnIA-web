// Mapeo de `reason` de las RPC de documentos a mensajes limpios para el
// cliente (PARTE J del pedido: "cliente: mensajes limpios, sin detalles
// internos"). El detalle técnico (code/message de Postgres) se loguea
// aparte, server-side únicamente — ver logExportError, reutilizado desde
// lib/export/response.ts en los route handlers.

const REASON_MESSAGE: Record<string, string> = {
  patient_not_found: 'Paciente no encontrado.',
  document_not_found: 'Documento no encontrado.',
  not_document_owner: 'No tenés permiso para modificar este documento.',
  already_superseded: 'Este documento ya tiene una versión más reciente.',
  already_signed: 'Este documento ya tiene una copia firmada cargada.',
  invalid_storage_path: 'No pudimos procesar el archivo. Intentá nuevamente.',
};

export function messageForDocumentRpcReason(reason: string | null): string {
  if (reason && reason in REASON_MESSAGE) return REASON_MESSAGE[reason];
  return 'No pudimos completar la operación. Intentá nuevamente.';
}

export function statusForDocumentRpcReason(reason: string | null): number {
  switch (reason) {
    case 'patient_not_found':
    case 'document_not_found':
      return 404;
    case 'not_document_owner':
      return 403;
    case 'already_superseded':
    case 'already_signed':
      return 409;
    case 'invalid_storage_path':
      return 400;
    default:
      return 500;
  }
}
