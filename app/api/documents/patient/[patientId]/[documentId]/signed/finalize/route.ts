// Paso 3/3 del flujo de subida directa del PDF firmado (revisión de
// transporte, PARTE 1.C del pedido).
//
// El browser ya subió el PDF directo a Supabase Storage con la signed
// upload URL de INITIATE — esos bytes nunca pasaron por esta Function.
// FINALIZE es quien de verdad autoriza y registra: vuelve a correr
// autorización desde cero (nunca asume que sigue siendo válido sólo
// porque INITIATE lo aprobó antes), reconstruye el path él mismo, baja el
// objeto REAL desde Storage con service-role, lo valida contra los bytes
// reales almacenados (nunca contra lo que dijo el browser) y sólo entonces
// llama a attach_signed_patient_document con el hash/tamaño reales.
//
// Input mínimo: { uploadUuid }. NO se confía en tenantId/patientId fuera
// de la URL, ni en un path arbitrario, ni en hash/tamaño/MIME que mande el
// browser — el servidor recalcula todo. El browser nunca decide
// signed_sha256 ni signed_bytes.
//
// ORDEN DE AUTORIZACIÓN/CLEANUP (dos pasos, deliberadamente separados):
//
//   B. findDocumentForSignedFinalizeAuthorization — ownership mínimo:
//      mismo tenant/paciente/documento y professional_user_id = usuario
//      actual, SIN exigir status. Si esto no matchea: 404 genérico y NO se
//      toca Storage — no hay ninguna garantía todavía de que el objeto en
//      ese path le pertenezca a este usuario.
//
//   E. findDocumentForSignedUploadPrecheck — el precheck estricto de
//      siempre (status='pending_signature' incluido). Si el documento SÍ
//      es del usuario (paso B ya lo confirmó) pero ya no está
//      pending_signature — se firmó por otro medio, el paciente se
//      archivó, etc., algo cambió entre INITIATE y FINALIZE — recién acá
//      se sabe que hay derecho a limpiar Storage: se borra el objeto
//      best-effort y se responde un mensaje limpio, sin tocar la RPC.
//
// Esto evita el problema original (un objeto subido después de INITIATE
// quedaba huérfano si el status cambiaba antes de FINALIZE) sin abrir la
// puerta a que alguien use FINALIZE para borrar el path de un documento
// ajeno: el borrado sólo ocurre después de confirmar ownership en el paso
// B, nunca antes.

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { logExportError } from '@/lib/export/response';
import { findDocumentForSignedFinalizeAuthorization, findDocumentForSignedUploadPrecheck } from '@/lib/documents/authorize';
import { messageForDocumentRpcReason, statusForDocumentRpcReason } from '@/lib/documents/errors';
import { sha256Hex } from '@/lib/documents/hash';
import { buildSignedStoragePath } from '@/lib/documents/paths';
import { documentErrorResponse } from '@/lib/documents/response';
import { downloadDocumentPdf, removeDocumentObjectBestEffort } from '@/lib/documents/storage';
import type { AttachSignedPatientDocumentRpcResult } from '@/lib/documents/types';
import { isPdfMagicBytes, isWithinMaxSignedSize } from '@/lib/documents/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// uploadUuid validado como UUID estricto (PARTE 6 del pedido) — junto con
// que buildSignedStoragePath sólo arma paths bajo
// tenant/patient/document/signed/<uuid>.pdf, esto garantiza que FINALIZE
// nunca pueda reconstruir un path fuera de ese prefijo fijo.
const bodySchema = z.object({
  uploadUuid: z.string().uuid(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ patientId: string; documentId: string }> }) {
  const { supabase, user, tenantId } = await requireTenant();
  const { patientId, documentId } = await params;

  // A. Validar UUIDs de la URL y body.
  const patientIdCheck = z.string().uuid().safeParse(patientId);
  const documentIdCheck = z.string().uuid().safeParse(documentId);
  if (!patientIdCheck.success || !documentIdCheck.success) return documentErrorResponse('Documento no encontrado.', 404);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return documentErrorResponse('Solicitud inválida.', 400);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return documentErrorResponse('Datos inválidos.', 400);
  const { uploadUuid } = parsed.data;

  // B. Autorización MÍNIMA (ownership/tenant/patient, sin exigir status).
  // Si esto no matchea, es 404 genérico y NO se toca Storage — no hay
  // ninguna base todavía para tocar el objeto de ese path.
  let authorization;
  try {
    authorization = await findDocumentForSignedFinalizeAuthorization(supabase, tenantId, patientIdCheck.data, documentIdCheck.data, user.id);
  } catch (err) {
    logExportError(`[documents] finalize — autorización falló — documento ${documentIdCheck.data}`, err);
    return documentErrorResponse('Ocurrió un error. Intentá nuevamente.', 500);
  }
  if (!authorization) return documentErrorResponse('Documento no encontrado.', 404);

  // C/D. El path SIEMPRE lo reconstruye el servidor a partir de tenantId
  // (de la sesión), patientId/documentId (de la URL, ya validados) y
  // uploadUuid (del body, validado como UUID) — nunca un path que mande el
  // cliente.
  const signedPath = buildSignedStoragePath(tenantId, patientIdCheck.data, documentIdCheck.data, uploadUuid);

  // E. Ahora sí, el precheck estricto de siempre (status='pending_signature'
  // incluido). Se vuelve a correr desde cero — nunca se reutiliza el
  // resultado de INITIATE.
  let precheck;
  try {
    precheck = await findDocumentForSignedUploadPrecheck(supabase, tenantId, patientIdCheck.data, documentIdCheck.data, user.id);
  } catch (err) {
    logExportError(`[documents] finalize — precheck falló — documento ${documentIdCheck.data}`, err);
    return documentErrorResponse('Ocurrió un error. Intentá nuevamente.', 500);
  }

  // F. El documento SÍ es del usuario (B ya lo confirmó) pero ya no está
  // pending_signature — algo cambió entre INITIATE y FINALIZE. Ya sabemos
  // que el objeto es "suyo", así que limpiamos Storage en vez de dejarlo
  // huérfano, y respondemos un mensaje limpio sin llamar a la RPC.
  if (!precheck) {
    await removeDocumentObjectBestEffort(signedPath, `finalize — documento ya no disponible para firmar — documento ${documentIdCheck.data}`);
    return documentErrorResponse('Documento no disponible para firmar.', 409);
  }

  // G. Validación normal sobre los bytes reales almacenados.

  // "Existe" (PARTE 5): si por algún motivo no hay objeto en ese path (el
  // browser nunca llegó a subir, por ejemplo), no hay nada que borrar.
  const buffer = await downloadDocumentPdf(signedPath);
  if (!buffer) {
    return documentErrorResponse('No encontramos el archivo subido. Subilo de nuevo.', 404);
  }

  // size > 0 y <= 20MB en un solo check (isWithinMaxSignedSize ya exige
  // ambos) — sobre los bytes reales descargados, nunca sobre un tamaño que
  // haya declarado el browser.
  if (!isWithinMaxSignedSize(buffer.byteLength)) {
    await removeDocumentObjectBestEffort(signedPath, `finalize — tamaño inválido — documento ${documentIdCheck.data}`);
    return documentErrorResponse('El archivo supera el tamaño máximo permitido (20MB) o está vacío.', 400);
  }

  // Primeros 5 bytes "%PDF-" sobre los bytes reales.
  if (!isPdfMagicBytes(buffer)) {
    await removeDocumentObjectBestEffort(signedPath, `finalize — no es PDF — documento ${documentIdCheck.data}`);
    return documentErrorResponse('El archivo no es un PDF válido.', 400);
  }

  // SHA-256 SIEMPRE calculado server-side sobre los bytes reales
  // almacenados — el browser nunca decide signed_sha256 ni signed_bytes.
  const signedSha256 = sha256Hex(buffer);

  const { data: rpcData, error: rpcError } = await supabase
    .rpc('attach_signed_patient_document', {
      p_document_id: documentIdCheck.data,
      p_signed_storage_path: signedPath,
      p_signed_sha256: signedSha256,
      p_signed_bytes: buffer.byteLength,
    })
    .single()
    .returns<AttachSignedPatientDocumentRpcResult>();

  if (rpcError || !rpcData?.ok) {
    await removeDocumentObjectBestEffort(signedPath, `finalize — documento ${documentIdCheck.data}`);

    if (rpcError) {
      logExportError(`[documents] attach_signed_patient_document falló — documento ${documentIdCheck.data}`, new Error(rpcError.message));
      return documentErrorResponse('No pudimos registrar el archivo firmado. Intentá nuevamente.', 500);
    }

    const reason = rpcData?.reason ?? null;
    return documentErrorResponse(messageForDocumentRpcReason(reason), statusForDocumentRpcReason(reason));
  }

  return NextResponse.json({ ok: true });
}
