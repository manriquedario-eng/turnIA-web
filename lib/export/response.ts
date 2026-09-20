import { NextResponse } from 'next/server';
import type { ExportFormat } from './types';

const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Respuesta de descarga autenticada (PARTE 2/17 del pedido): el archivo se genera server-side bajo demanda, nunca una URL pública permanente. */
export function exportFileResponse(buffer: Buffer, filename: string, format: ExportFormat) {
  // NextResponse tipa su body como BodyInit del DOM (ArrayBufferView | Blob |
  // ReadableStream | ...), y un Buffer de Node no siempre queda cubierto por
  // ese tipo según la config de TS del proyecto. Lo convertimos a un
  // Uint8Array "puro" (copia los bytes, sin depender del offset/pool interno
  // del Buffer) antes de pasarlo — mismo contenido binario, tipo compatible.
  const body = new Uint8Array(buffer);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': MIME_BY_FORMAT[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(buffer.byteLength),
    },
  });
}

export function exportErrorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Log de diagnóstico server-side para fallos de generación de archivos
 * (PDF/DOCX/XLSX). Nunca se expone al cliente — el endpoint sigue devolviendo
 * el mensaje limpio de exportErrorResponse. Loguea nombre, mensaje y stack
 * completos para poder identificar la causa real (antes solo se logueaba
 * err.message, lo que ocultaba en qué archivo/línea ocurría el error).
 */
export function logExportError(context: string, err: unknown) {
  if (err instanceof Error) {
    console.error(`[export] ${context}:`, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  } else {
    console.error(`[export] ${context}: error no-Error`, err);
  }
}

const VALID_FORMATS = new Set<ExportFormat>(['pdf', 'docx', 'xlsx']);

export function parseExportFormat(value: string | null, allowed: ExportFormat[]): ExportFormat | null {
  if (!value || !VALID_FORMATS.has(value as ExportFormat)) return null;
  const format = value as ExportFormat;
  return allowed.includes(format) ? format : null;
}
