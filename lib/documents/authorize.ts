// Resolución + autorización server-side de documentos vía el cliente
// RLS-scoped normal (nunca el service-role para decidir autorización —
// PARTE I del pedido). Mismo criterio que lib/export/authorize.ts: todo
// `.eq('tenant_id', tenantId)` explícito además de la RLS de la tabla
// (defensa en profundidad), y un documento que no matchea exactamente
// (no existe, es de otro paciente, o de otro tenant) se trata siempre
// igual — el caller responde 404 genérico sin distinguir el motivo.
//
// Estos SELECT son pre-checks para UX y para saber qué mostrar/permitir —
// la autoridad final sobre cualquier mutación sigue siendo la RPC
// correspondiente (create_patient_document / attach_signed_patient_document),
// que vuelve a validar todo bajo lock (PARTE I: "nunca confiar sólo en
// este pre-check").
//
// IMPORTANTE (revisión de transporte, PARTE 4 del pedido): "no encontrado"
// y "la consulta falló técnicamente" son dos cosas distintas y hay que
// distinguirlas. Antes estas funciones hacían `return data ?? null` sin
// mirar `error`, lo que convertía cualquier fallo real de Postgres/red en
// un 404 silencioso. Ahora, si `error` viene seteado, se lanza — el caller
// (route handler) es quien decide qué hacer con eso: capturarlo, loguearlo
// server-side con detalle técnico, y devolver un 500 limpio sin exponer el
// mensaje de Postgres al cliente. `null` sigue significando exclusivamente
// "no matchea" (no existe / otro paciente / otro tenant / otro dueño /
// otro status, según la función).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { DocumentType } from './types';

/** Se lanza cuando el SELECT de autorización falló técnicamente (no cuando simplemente no matchea ninguna fila). El caller lo captura y responde 500 sin filtrar el mensaje de Postgres. */
export class DocumentAuthorizeQueryError extends Error {
  readonly cause: PostgrestError;

  constructor(cause: PostgrestError) {
    super(cause.message);
    this.name = 'DocumentAuthorizeQueryError';
    this.cause = cause;
  }
}

function unwrap<T>(data: T | null, error: PostgrestError | null): T | null {
  if (error) throw new DocumentAuthorizeQueryError(error);
  return data ?? null;
}

export type DocumentForOriginalDownload = {
  id: string;
  patient_id: string;
  tenant_id: string;
  professional_user_id: string;
  document_type: DocumentType;
  document_label: string | null;
  version: number;
  original_storage_path: string;
};

/** Metadata mínima para descargar el original — el caller valida que exista antes de tocar Storage. */
export async function findDocumentForOriginalDownload(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  documentId: string,
): Promise<DocumentForOriginalDownload | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, document_type, document_label, version, original_storage_path')
    .eq('id', documentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return unwrap(data as DocumentForOriginalDownload | null, error);
}

export type DocumentForSignedDownload = DocumentForOriginalDownload & {
  status: string;
  signed_storage_path: string | null;
};

/** Sólo matchea si ya tiene una copia firmada disponible, ya sea cargada manualmente o confirmada por el proveedor. */
export async function findDocumentForSignedDownload(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  documentId: string,
): Promise<DocumentForSignedDownload | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, document_type, document_label, version, original_storage_path, status, signed_storage_path')
    .eq('id', documentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .in('status', ['signed_uploaded_unverified', 'signed_provider_confirmed'])
    .maybeSingle();
  return unwrap(data as DocumentForSignedDownload | null, error);
}

export type DocumentForSignedUploadPrecheck = {
  id: string;
  patient_id: string;
  tenant_id: string;
  professional_user_id: string;
  status: string;
  document_type: DocumentType;
  version: number;
};

/**
 * Pre-check de UX antes de subir el PDF firmado: mismo tenant, mismo
 * paciente, status='pending_signature' Y professional_user_id = quien
 * está pidiendo (ownership estricto, PARTE F/I). Evita gastar una subida a
 * Storage cuando ya sabemos que la RPC la va a rechazar — pero la RPC
 * (attach_signed_patient_document) es la que decide de verdad, bajo lock.
 *
 * Se usa tanto en INITIATE como en FINALIZE del flujo de subida directa —
 * cada uno lo vuelve a correr desde cero, nunca se reutiliza el resultado
 * de uno en el otro.
 */
export async function findDocumentForSignedUploadPrecheck(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  documentId: string,
  userId: string,
): Promise<DocumentForSignedUploadPrecheck | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, status, document_type, version')
    .eq('id', documentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending_signature')
    .eq('professional_user_id', userId)
    .maybeSingle();
  return unwrap(data as DocumentForSignedUploadPrecheck | null, error);
}

export type DocumentForSignedFinalizeAuthorization = {
  id: string;
  patient_id: string;
  tenant_id: string;
  professional_user_id: string;
  status: string;
};

/**
 * Autorización MÍNIMA para FINALIZE — deliberadamente separada de
 * findDocumentForSignedUploadPrecheck. Verifica sólo ownership real (mismo
 * tenant, mismo paciente, mismo documento, professional_user_id =
 * usuario actual) y NO exige status='pending_signature'.
 *
 * Por qué existe: entre INITIATE y FINALIZE puede pasar tiempo, y el
 * status del documento puede cambiar por otro camino (se firmó por otro
 * medio, el paciente se archivó, etc.). Si FINALIZE sólo tuviera el
 * precheck estricto de status, un documento que dejó de estar
 * 'pending_signature' haría que FINALIZE devuelva 404 sin tocar Storage —
 * y el objeto que el browser ya subió a ESE path (bajo
 * tenant/patient/document/signed/uploadUuid.pdf) queda huérfano para
 * siempre, porque nadie vuelve a intentar limpiarlo.
 *
 * Este helper resuelve eso sin debilitar autorización: FINALIZE lo corre
 * primero, ANTES de tocar Storage. Si no matchea (no existe / otro
 * paciente / otro tenant / otro dueño), es un 404 genérico y no se borra
 * nada — nunca se usa este resultado para autorizar un borrado de un
 * documento que no es del usuario. Si matchea (el documento es del
 * usuario, sea cual sea su status actual), recién ahí FINALIZE sabe que
 * tiene derecho a limpiar el objeto de Storage si el precheck estricto de
 * status falla a continuación. La RPC attach_signed_patient_document
 * sigue siendo la autoridad final para el registro en sí.
 */
export async function findDocumentForSignedFinalizeAuthorization(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  documentId: string,
  userId: string,
): Promise<DocumentForSignedFinalizeAuthorization | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, status')
    .eq('id', documentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .eq('professional_user_id', userId)
    .maybeSingle();
  return unwrap(data as DocumentForSignedFinalizeAuthorization | null, error);
}

export type PreviousDocumentForVersioning = {
  id: string;
  patient_id: string;
  tenant_id: string;
  professional_user_id: string;
  document_type: DocumentType;
  version: number;
  document_group_id: string;
};

/**
 * Documento anterior que se va a versionar (PARTE H del pedido): mismo
 * tenant, mismo paciente, mismo professional_user_id que quien pide la
 * nueva versión — el browser nunca puede versionar el documento de otro
 * profesional, ni cambiar arbitrariamente el document_type: el caller usa
 * `document_type` de ESTA fila como fuente de verdad, ignorando lo que
 * haya mandado el cliente. La RPC vuelve a validar ownership/concurrencia
 * de todos modos.
 */
export async function findPreviousDocumentForVersioning(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  userId: string,
  supersedesDocumentId: string,
): Promise<PreviousDocumentForVersioning | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, document_type, version, document_group_id')
    .eq('id', supersedesDocumentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .eq('professional_user_id', userId)
    .maybeSingle();
  return unwrap(data as PreviousDocumentForVersioning | null, error);
}


export type DocumentForProviderSignature = {
  id: string;
  patient_id: string;
  tenant_id: string;
  professional_user_id: string;
  status: string;
  document_type: DocumentType;
  version: number;
  original_storage_path: string;
};

export async function findDocumentForProviderSignature(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  documentId: string,
  userId: string,
): Promise<DocumentForProviderSignature | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, status, document_type, version, original_storage_path')
    .eq('id', documentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .eq('professional_user_id', userId)
    .in('status', ['pending_signature', 'provider_signature_rejected'])
    .maybeSingle();
  return unwrap(data as DocumentForProviderSignature | null, error);
}

export type DocumentForProviderCallback = DocumentForProviderSignature & {
  provider_document_id: string | null;
  signature_provider: string | null;
};

export async function findDocumentForProviderCallback(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  documentId: string,
  userId: string,
): Promise<DocumentForProviderCallback | null> {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id, patient_id, tenant_id, professional_user_id, status, document_type, version, original_storage_path, provider_document_id, signature_provider')
    .eq('id', documentId)
    .eq('patient_id', patientId)
    .eq('tenant_id', tenantId)
    .eq('professional_user_id', userId)
    .eq('status', 'provider_signature_pending')
    .eq('signature_provider', 'digilogix')
    .maybeSingle();
  return unwrap(data as DocumentForProviderCallback | null, error);
}
