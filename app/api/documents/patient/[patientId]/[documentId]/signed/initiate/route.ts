// Paso 1/3 del flujo de subida directa del PDF firmado (revisión de
// transporte, PARTE 1.A del pedido) — reemplaza al POST que antes recibía
// el multipart/form-data completo a través de esta Vercel Function.
//
// No recibe archivo: sólo autoriza (mismo pre-check que antes tenía el
// POST directo — mismo tenant/paciente/dueño/status='pending_signature') y
// devuelve una signed upload URL/token de Supabase Storage para que el
// FUTURO cliente suba el PDF con `storage.from(bucket).uploadToSignedUrl(
// path, token, file)` directo a Storage — los bytes nunca atraviesan esta
// Function.
//
// El path SIEMPRE lo construye el servidor, con un uploadUuid nuevo
// generado acá (crypto.randomUUID()) — nunca se acepta un path calculado
// por el browser (PARTE C/I). Que el path vuelva en la respuesta es sólo
// porque `uploadToSignedUrl` lo necesita técnicamente: eso NO autoriza
// nada por sí solo. La autoridad real es FINALIZE, que vuelve a
// autorizar todo desde cero y es quien decide si el documento queda
// registrado. Nunca se devuelve la service key ni se crea ninguna policy
// pública/authenticated.

import { randomUUID } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { logExportError } from '@/lib/export/response';
import { findDocumentForSignedUploadPrecheck } from '@/lib/documents/authorize';
import { buildSignedStoragePath } from '@/lib/documents/paths';
import { documentErrorResponse } from '@/lib/documents/response';
import { createSignedUploadTarget } from '@/lib/documents/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ patientId: string; documentId: string }> }) {
  const { supabase, user, tenantId } = await requireTenant();
  const { patientId, documentId } = await params;

  const patientIdCheck = z.string().uuid().safeParse(patientId);
  const documentIdCheck = z.string().uuid().safeParse(documentId);
  if (!patientIdCheck.success || !documentIdCheck.success) return documentErrorResponse('Documento no encontrado.', 404);

  // Pre-check de UX — la RPC (llamada recién en FINALIZE) es la autoridad
  // final bajo lock; esto sólo evita generar una signed upload URL cuando
  // ya sabemos que la subida no va a poder registrarse.
  let precheck;
  try {
    precheck = await findDocumentForSignedUploadPrecheck(supabase, tenantId, patientIdCheck.data, documentIdCheck.data, user.id);
  } catch (err) {
    logExportError(`[documents] initiate — precheck falló — documento ${documentIdCheck.data}`, err);
    return documentErrorResponse('Ocurrió un error. Intentá nuevamente.', 500);
  }
  if (!precheck) return documentErrorResponse('Documento no encontrado o no disponible para firmar.', 404);

  const uploadUuid = randomUUID();
  const signedPath = buildSignedStoragePath(tenantId, patientIdCheck.data, documentIdCheck.data, uploadUuid);

  const target = await createSignedUploadTarget(signedPath);
  if (!target) {
    logExportError(`[documents] initiate — no se pudo crear signed upload URL — documento ${documentIdCheck.data}`, new Error('createSignedUploadUrl failed'));
    return documentErrorResponse('No pudimos preparar la subida. Intentá nuevamente.', 500);
  }

  return NextResponse.json({
    ok: true,
    documentId: documentIdCheck.data,
    uploadUuid,
    token: target.token,
    path: target.path,
  });
}
