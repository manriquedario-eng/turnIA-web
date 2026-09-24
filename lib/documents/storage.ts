// Acceso a Storage del bucket `patient-documents` — SIEMPRE con el cliente
// service-role, SIEMPRE server-side (PARTE C del pedido). El bucket es
// privado y no tiene policies directas para anon/authenticated (ver la
// migración), así que el SDK de Storage con la sesión del usuario no
// podría acceder de todos modos — esto es además defensa en profundidad
// explícita, nunca se intenta con el cliente normal.
//
// Reglas que se repiten en cada función: `upsert: false` (nunca pisar un
// objeto existente — cada path ya es único por construcción, ver
// paths.ts), `contentType: 'application/pdf'` fijo cuando aplica, y nunca
// se devuelve al cliente ni el path de Storage ni el buffer completo del
// PDF (ver PARTE C/I y la revisión de transporte, PARTE 2 del pedido):
// las descargas se resuelven con una signed URL de corta duración, no
// proxeando el archivo a través de esta Function.

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logExportError } from '@/lib/export/response';

export const PATIENT_DOCUMENTS_BUCKET = 'patient-documents';

export type UploadResult = { ok: true } | { ok: false; error: string };

async function uploadPdf(path: string, buffer: Buffer): Promise<UploadResult> {
  const service = createSupabaseServiceClient();
  const { error } = await service.storage.from(PATIENT_DOCUMENTS_BUCKET).upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function uploadOriginalPdf(path: string, buffer: Buffer): Promise<UploadResult> {
  return uploadPdf(path, buffer);
}

/** Guarda un PDF firmado devuelto por un proveedor server-side. El path se construye con buildSignedStoragePath y nunca proviene del proveedor. */
export async function uploadProviderSignedPdf(path: string, buffer: Buffer): Promise<UploadResult> {
  return uploadPdf(path, buffer);
}

/**
 * Descarga el objeto real desde Storage. Ya NO se usa para servir descargas
 * al browser (eso ahora es una signed URL, ver `createDocumentDownloadUrl`)
 * — el único caller que queda es FINALIZE del flujo de subida directa, que
 * necesita los bytes reales para validarlos (tamaño, magic bytes) y
 * calcular el SHA-256 server-side. Devuelve `null` en cualquier fallo — el
 * caller decide el mensaje/status hacia el cliente.
 */
export async function downloadDocumentPdf(path: string): Promise<Buffer | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage.from(PATIENT_DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export type SignedUploadTarget = { path: string; token: string };

/**
 * Paso INITIATE del flujo de subida directa (PARTE 1.A del pedido): crea
 * una signed upload URL/token para que el browser suba el PDF firmado
 * directo a Storage con `uploadToSignedUrl`, sin que los bytes atraviesen
 * esta Vercel Function. `upsert: false` explícito — el path ya es único
 * por construcción (uploadUuid nuevo en cada INITIATE), así que nunca
 * debería existir de antemano; si existiera, preferimos que falle a que
 * pise algo.
 *
 * Duración del token: según la documentación oficial de Supabase, un
 * signed upload token es válido hasta 2 horas — ese valor lo fija Supabase
 * y esta capa NO lo controla ni lo configura (a diferencia de la signed
 * download URL de `createDocumentDownloadUrl`, donde el TTL de 60s sí lo
 * elegimos nosotros vía `expiresIn`). No hay que leer "válido hasta 2
 * horas" como una garantía de que el upload pendiente expira solo a esa
 * hora exacta en todos los casos — es el límite documentado por Supabase,
 * no algo que hayamos verificado contra su comportamiento interno. Nunca
 * se devuelve la service key: sólo el token que Supabase Storage emite
 * para ESE path puntual.
 */
export async function createSignedUploadTarget(path: string): Promise<SignedUploadTarget | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage
    .from(PATIENT_DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data) return null;
  return { path: data.path, token: data.token };
}

/**
 * Signed download URL de corta vida (PARTE 2 del pedido) para que el
 * browser baje el PDF directo desde Supabase Storage — nunca proxeado
 * entero a través de esta Function. TTL de 60 segundos: a diferencia del
 * signed upload token de `createSignedUploadTarget` (cuya duración de 2hs
 * la fija Supabase y no es configurable acá), este TTL sí lo elegimos
 * nosotros explícitamente vía el segundo argumento `expiresIn=60` de
 * `createSignedUrl` — por eso podemos garantizar que expira en 60s.
 * Generado siempre DESPUÉS de que el caller ya autorizó con el cliente
 * RLS-scoped normal (esta función nunca decide autorización, sólo genera
 * la URL una vez autorizado). El bucket sigue siendo privado: esto no es
 * una URL pública permanente. `download` fija el filename seguro que ya
 * arma `lib/documents/filename.ts`.
 */
export async function createDocumentDownloadUrl(path: string, filename: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage
    .from(PATIENT_DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60, { download: filename });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Compensación best-effort (PARTE 9/C del pedido): Storage y la DB no son
 * una transacción, así que si la RPC rechaza el registro después de que ya
 * hay un objeto en ese path (subido por el browser directo, o por esta
 * capa), intentamos borrarlo. Si el borrado también falla, se loguea
 * server-side y NUNCA se oculta el error primario (el de la RPC/validación)
 * al usuario — este helper no lanza ni devuelve nada que el caller tenga
 * que manejar, es deliberadamente "dispara y olvida" salvo por el log.
 */
export async function removeDocumentObjectBestEffort(path: string, context: string): Promise<void> {
  try {
    const service = createSupabaseServiceClient();
    const { error } = await service.storage.from(PATIENT_DOCUMENTS_BUCKET).remove([path]);
    if (error) {
      logExportError(`[documents] compensación de Storage falló (best-effort) — ${context}`, new Error(error.message));
    }
  } catch (err) {
    logExportError(`[documents] compensación de Storage lanzó excepción (best-effort) — ${context}`, err);
  }
}
