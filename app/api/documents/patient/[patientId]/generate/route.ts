// Genera un PDF de documento para firma externa y registra su metadata
// (Fase 1 de firma digital externa, PARTE D/H del pedido).
//
// Flujo: generar buffer -> calcular hash -> subir a Storage -> llamar
// create_patient_document. Storage y la DB no son una transacción: si la
// RPC rechaza, se borra el objeto recién subido (compensación best-effort,
// ver lib/documents/storage.ts). Si la subida a Storage falla, la RPC ni
// se llama.
//
// Este mismo endpoint sirve para crear una NUEVA VERSIÓN (PARTE H): no hay
// una ruta separada — cuando el body trae `supersedesDocumentId`, se busca
// el documento anterior (mismo tenant/paciente/profesional) y su
// `document_type` real se usa como fuente de verdad, ignorando lo que haya
// mandado el cliente — el browser nunca puede cambiar arbitrariamente el
// tipo al versionar. La RPC vuelve a validar ownership/concurrencia bajo
// lock de todos modos.
//
// Sólo 'ficha_clinica' tiene generación real por ahora (reutiliza
// fetchPatientExportData + renderPatientPdf, exactamente igual que
// app/api/export/patient/[id]/route.ts con section='clinical') — cualquier
// otro tipo responde 422 sin inventar contenido.

import { randomUUID } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchPatientExportData } from '@/lib/export/authorize';
import { logExportError } from '@/lib/export/response';
import type { PatientExportSection } from '@/lib/export/types';
import { renderPatientPdf } from '@/lib/export/pdf/render';
import { findPreviousDocumentForVersioning } from '@/lib/documents/authorize';
import { messageForDocumentRpcReason, statusForDocumentRpcReason } from '@/lib/documents/errors';
import { sha256Hex } from '@/lib/documents/hash';
import { buildOriginalStoragePath } from '@/lib/documents/paths';
import { removeDocumentObjectBestEffort, uploadOriginalPdf } from '@/lib/documents/storage';
import { DOCUMENT_TYPES, type CreatePatientDocumentRpcResult, type DocumentType } from '@/lib/documents/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES as [DocumentType, ...DocumentType[]]),
  documentLabel: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(200).nullable().optional(),
  ),
  supersedesDocumentId: z.preprocess(
    (value) => (value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
    z.string().uuid().optional(),
  ),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const { supabase, user, tenantId } = await requireTenant();
  const { patientId } = await params;

  const patientIdCheck = z.string().uuid().safeParse(patientId);
  if (!patientIdCheck.success) return NextResponse.json({ error: 'Paciente inválido.' }, { status: 400 });

  const contentType = request.headers.get('content-type') ?? '';
  const wantsHtmlRedirect = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  let payload: unknown;
  try {
    if (wantsHtmlRedirect) {
      const form = await request.formData();
      payload = {
        documentType: form.get('documentType'),
        documentLabel: form.get('documentLabel'),
        supersedesDocumentId: form.get('supersedesDocumentId'),
      };
    } else {
      payload = await request.json();
    }
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 });

  const documentLabel = parsed.data.documentLabel ?? null;
  const supersedesDocumentId = parsed.data.supersedesDocumentId ?? null;
  let documentType: DocumentType = parsed.data.documentType;

  if (supersedesDocumentId) {
    // No encontrado vs. fallo técnico de la consulta se distinguen (PARTE 4
    // del pedido): un error real de Postgres ya no se trata como "no
    // encontrado" silenciosamente.
    let previous;
    try {
      previous = await findPreviousDocumentForVersioning(supabase, tenantId, patientIdCheck.data, user.id, supersedesDocumentId);
    } catch (err) {
      logExportError(`[documents] generate — consulta de versionado falló — paciente ${patientIdCheck.data}`, err);
      return NextResponse.json({ error: 'Ocurrió un error. Intentá nuevamente.' }, { status: 500 });
    }
    if (!previous) return NextResponse.json({ error: 'Documento anterior no encontrado.' }, { status: 404 });
    // El tipo de la nueva versión nunca lo decide el browser: se hereda de
    // la fila que se está versionando (PARTE H — "no dejar que el browser
    // cambie arbitrariamente el tipo al versionar").
    documentType = previous.document_type;
  }

  if (documentType !== 'ficha_clinica') {
    return NextResponse.json({ error: 'Este tipo de documento todavía no tiene una plantilla disponible.' }, { status: 422 });
  }

  const data = await fetchPatientExportData(supabase, user.id, tenantId, patientIdCheck.data, user.email ?? null);
  if (!data) return NextResponse.json({ error: 'Paciente no encontrado.' }, { status: 404 });

  const documentId = randomUUID();

  let buffer: Buffer;
  try {
    buffer = await renderPatientPdf(data, new Set<PatientExportSection>(['clinical']));
  } catch (err) {
    logExportError(`[documents] generate — paciente ${patientIdCheck.data} — documento ${documentId}`, err);
    return NextResponse.json({ error: 'No pudimos generar el documento. Intentá nuevamente.' }, { status: 500 });
  }

  const originalSha256 = sha256Hex(buffer);
  const originalPath = buildOriginalStoragePath(tenantId, patientIdCheck.data, documentId);

  const uploadResult = await uploadOriginalPdf(originalPath, buffer);
  if (!uploadResult.ok) {
    logExportError(`[documents] generate — falló la subida del original — documento ${documentId}`, new Error(uploadResult.error));
    return NextResponse.json({ error: 'No pudimos guardar el documento. Intentá nuevamente.' }, { status: 500 });
  }

  const { data: rpcData, error: rpcError } = await supabase
    .rpc('create_patient_document', {
      p_document_id: documentId,
      p_patient_id: patientIdCheck.data,
      p_document_type: documentType,
      p_document_label: documentLabel,
      p_original_storage_path: originalPath,
      p_original_sha256: originalSha256,
      p_original_bytes: buffer.byteLength,
      p_supersedes_document_id: supersedesDocumentId,
    })
    .single()
    .returns<CreatePatientDocumentRpcResult>();

  if (rpcError || !rpcData?.ok) {
    // Compensación best-effort: la DB rechazó el registro, el objeto que ya
    // subimos a Storage queda huérfano si no lo borramos (PARTE 9 del pedido).
    await removeDocumentObjectBestEffort(originalPath, `generate — documento ${documentId}`);

    if (rpcError) {
      logExportError(`[documents] create_patient_document falló — documento ${documentId}`, new Error(rpcError.message));
      return NextResponse.json({ error: 'No pudimos registrar el documento. Intentá nuevamente.' }, { status: 500 });
    }

    const reason = rpcData?.reason ?? null;
    return NextResponse.json({ error: messageForDocumentRpcReason(reason) }, { status: statusForDocumentRpcReason(reason) });
  }

  if (wantsHtmlRedirect) {
    return NextResponse.redirect(
      new URL(
        `/patients/${patientIdCheck.data}?success=${encodeURIComponent('Documento generado y listo para firmar.')}#documentos`,
        request.url,
      ),
      { status: 303 },
    );
  }

  return NextResponse.json({
    ok: true,
    documentId: rpcData.document_id,
    documentGroupId: rpcData.document_group_id,
    version: rpcData.version,
  });
}
