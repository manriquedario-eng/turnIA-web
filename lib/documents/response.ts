// Respuestas HTTP del sistema de documentos.
//
// `documentPdfResponse` (que devolvía el buffer completo del PDF en la
// respuesta de esta Vercel Function) se eliminó en la revisión de
// transporte: las descargas ahora son un redirect 307 a una signed URL de
// Supabase Storage de corta duración (ver route handlers de
// original/signed y `createDocumentDownloadUrl` en storage.ts), así que el
// PDF nunca vuelve a viajar completo por esta capa. No queda ningún caller
// de `documentPdfResponse` en este módulo.

import { NextResponse } from 'next/server';

export function documentErrorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
