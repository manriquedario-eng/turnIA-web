// Descarga el PDF original generado por TurnIA (PARTE E del pedido).
//
// Autorización en dos pasos, nunca al revés (PARTE I): primero se valida
// la metadata con el cliente RLS-scoped normal (tenant/paciente/documento
// tienen que matchear exactamente); sólo si eso matchea se usa el cliente
// service-role. El service-role nunca decide autorización acá.
//
// REVISIÓN DE TRANSPORTE (PARTE 2 del pedido): esta Function corre en
// Vercel, con un límite de ~4.5MB de response payload. Antes esta ruta
// bajaba el PDF entero desde Supabase Storage y lo devolvía completo en la
// respuesta (`downloadDocumentPdf` + `documentPdfResponse`), lo que hacía
// fallar cualquier documento de más de ~4.5MB pese a ser válido (el límite
// de producto es 20MB). Ahora, una vez autorizado, se genera una signed
// download URL de 60 segundos directo a Supabase Storage y se redirige al
// browser ahí — el PDF nunca vuelve a atravesar esta Function completo.
//
// 307 (no 302): es un GET puro y sin body, así que para este caso 307 y
// 302 se comportan igual en la práctica (ningún browser cambia el método
// en un redirect de GET), pero 307 deja explícito en el código HTTP que es
// "temporal, no cambiés método/semántica" — más preciso que 302, que
// históricamente se usó para casos ambiguos. `Cache-Control: no-store` en
// la respuesta de redirect para que ni el browser ni un proxy intermedio
// cacheen una URL que expira sola en 60s.

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { logExportError } from '@/lib/export/response';
import { findDocumentForOriginalDownload } from '@/lib/documents/authorize';
import { buildOriginalDownloadFilename } from '@/lib/documents/filename';
import { documentErrorResponse } from '@/lib/documents/response';
import { createDocumentDownloadUrl } from '@/lib/documents/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ patientId: string; documentId: string }> }) {
  const { supabase, tenantId } = await requireTenant();
  const { patientId, documentId } = await params;

  const patientIdCheck = z.string().uuid().safeParse(patientId);
  const documentIdCheck = z.string().uuid().safeParse(documentId);
  if (!patientIdCheck.success || !documentIdCheck.success) return documentErrorResponse('Documento no encontrado.', 404);

  // Mismo criterio que fetchPatientExportData: no existe / es de otro
  // paciente / es de otro tenant se tratan todos igual — 404 genérico, sin
  // distinguir el motivo. Un fallo TÉCNICO de la consulta (no un "no
  // encontrado") se distingue y responde 500 (PARTE 4 del pedido).
  let document;
  try {
    document = await findDocumentForOriginalDownload(supabase, tenantId, patientIdCheck.data, documentIdCheck.data);
  } catch (err) {
    logExportError(`[documents] download original — consulta falló — documento ${documentIdCheck.data}`, err);
    return documentErrorResponse('Ocurrió un error. Intentá nuevamente.', 500);
  }
  if (!document) return documentErrorResponse('Documento no encontrado.', 404);

  const filename = buildOriginalDownloadFilename(document.document_type, document.version);
  const downloadUrl = await createDocumentDownloadUrl(document.original_storage_path, filename);
  if (!downloadUrl) {
    logExportError(`[documents] download original falló — documento ${documentIdCheck.data}`, new Error('createSignedUrl failed'));
    return documentErrorResponse('No pudimos descargar el documento. Intentá nuevamente.', 500);
  }

  return NextResponse.redirect(downloadUrl, { status: 307, headers: { 'Cache-Control': 'no-store' } });
}
