// Descarga el PDF firmado subido externamente — Fase 1 de firma digital
// externa, PARTE G del pedido.
//
// El POST que subía el multipart/form-data completo a través de esta
// Vercel Function se ELIMINÓ en la revisión de transporte: ver
// signed/initiate/route.ts y signed/finalize/route.ts, que lo reemplazan
// por un flujo initiate -> upload directo a Storage -> finalize. Esta ruta
// ahora sólo expone GET (descarga).
//
// Mismo esquema de autorización en dos pasos que .../original: metadata
// con el cliente RLS-scoped primero (exige además
// status='signed_uploaded_unverified'), service-role después — pero ahora
// el service-role sólo se usa para generar una signed download URL de 60
// segundos, nunca para bajar y reenviar el PDF entero (mismo razonamiento
// de límite de payload de Vercel que en original/route.ts).

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { logExportError } from '@/lib/export/response';
import { findDocumentForSignedDownload } from '@/lib/documents/authorize';
import { buildSignedDownloadFilename } from '@/lib/documents/filename';
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

  let document;
  try {
    document = await findDocumentForSignedDownload(supabase, tenantId, patientIdCheck.data, documentIdCheck.data);
  } catch (err) {
    logExportError(`[documents] download signed — consulta falló — documento ${documentIdCheck.data}`, err);
    return documentErrorResponse('Ocurrió un error. Intentá nuevamente.', 500);
  }
  if (!document || !document.signed_storage_path) return documentErrorResponse('Documento no encontrado.', 404);

  const filename = buildSignedDownloadFilename(document.document_type, document.version);
  const downloadUrl = await createDocumentDownloadUrl(document.signed_storage_path, filename);
  if (!downloadUrl) {
    logExportError(`[documents] download signed falló — documento ${documentIdCheck.data}`, new Error('createSignedUrl failed'));
    return documentErrorResponse('No pudimos descargar el documento. Intentá nuevamente.', 500);
  }

  // Ver original/route.ts para el razonamiento de 307 + no-store.
  return NextResponse.redirect(downloadUrl, { status: 307, headers: { 'Cache-Control': 'no-store' } });
}
