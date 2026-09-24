// Tipos del sistema de documentos con firma digital externa — Fase 1
// (ver supabase/migrations/20260918172244_patient_documents_signature.sql).
//
// TurnIA NO firma digitalmente por sí mismo en esta fase: el profesional
// genera un PDF, lo descarga, lo firma con su propia herramienta FUERA de
// TurnIA, y sube el PDF ya firmado de vuelta. Por eso el estado post-carga
// es 'signed_uploaded_unverified' — nunca 'signed' a secas — y ningún texto
// de esta capa debe decir "firma verificada".

export type DocumentType = 'ficha_clinica' | 'consentimiento_informado' | 'informe_clinico' | 'otro';

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'ficha_clinica',
  'consentimiento_informado',
  'informe_clinico',
  'otro',
];

export type DocumentStatus = 'pending_signature' | 'provider_signature_pending' | 'provider_signature_rejected' | 'signed_uploaded_unverified' | 'signed_provider_confirmed';

/**
 * Fila de public.patient_documents, en camelCase, limitada a los campos que
 * esta capa server-side necesita pasar entre helpers. Nunca se expone tal
 * cual al cliente (los route handlers arman su propia respuesta JSON
 * reducida — ver PARTE D/E/F/G del pedido: preferentemente no devolver
 * hashes ni storage paths).
 */
export type PatientDocument = {
  id: string;
  tenantId: string;
  patientId: string;
  professionalUserId: string;
  documentType: DocumentType;
  documentLabel: string | null;
  status: DocumentStatus;
  originalStoragePath: string;
  signedStoragePath: string | null;
  documentGroupId: string;
  version: number;
  supersedesDocumentId: string | null;
};

// Tipado a mano contra la firma SQL real de cada RPC (ver la migración
// citada arriba) — el cliente de Supabase de este proyecto no se crea con
// un generic `Database` (ver lib/supabase/server.ts), así que sin este
// tipado explícito `.rpc(...).single()` infiere `data` como `{}`. Mismo
// criterio que app/(protected)/patients/actions.ts para las RPC de
// auditoría clínica.

export type CreatePatientDocumentRpcResult = {
  ok: boolean;
  document_id: string | null;
  document_group_id: string | null;
  version: number | null;
  reason: string | null;
};

export type AttachSignedPatientDocumentRpcResult = {
  ok: boolean;
  reason: string | null;
};
