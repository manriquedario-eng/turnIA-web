// Construcción de storage paths para el bucket `patient-documents`.
//
// Estas funciones son la ÚNICA fuente de verdad de cómo se arma un path —
// nunca se acepta un path calculado por el cliente/browser (PARTE C/I del
// pedido). Los mismos formatos están re-validados server-side dentro de
// las RPC create_patient_document / attach_signed_patient_document (ver
// v_expected_original_path y el regex de p_signed_storage_path en
// supabase/migrations/20260918172244_patient_documents_signature.sql) —
// esta capa tiene que construirlos exactamente igual para que esa
// validación nunca rechace una subida legítima.
//
// Deliberadamente sin ningún import (funciones puras, sin IO) para poder
// testearlas de forma aislada sin depender de Next.js ni de Supabase.

export function buildOriginalStoragePath(tenantId: string, patientId: string, documentId: string): string {
  return `${tenantId}/${patientId}/${documentId}/original.pdf`;
}

/** uploadUuid es crypto.randomUUID() generado en el endpoint — nunca el nombre real del archivo que subió el profesional (PARTE C: "nunca usar el nombre original del archivo como storage path"). */
export function buildSignedStoragePath(tenantId: string, patientId: string, documentId: string, uploadUuid: string): string {
  return `${tenantId}/${patientId}/${documentId}/signed/${uploadUuid}.pdf`;
}
