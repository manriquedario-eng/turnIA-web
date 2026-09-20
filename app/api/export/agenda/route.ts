// Exportación de Agenda — Excel, PDF o Word, según vista (día/semana/mes) y
// fecha ancla (PARTE 10 original; Word agregado en la pasada de corrección
// de PARTE 3). No incluye meeting_url (a propósito, ver
// lib/export/authorize.ts).

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchAgendaExportData } from '@/lib/export/authorize';
import { buildExportFilename } from '@/lib/export/filename';
import { exportErrorResponse, exportFileResponse, logExportError, parseExportFormat } from '@/lib/export/response';
import { buildAgendaWorkbook } from '@/lib/export/xlsx/agenda';
import { buildAgendaDocx } from '@/lib/export/docx/agenda';
import { renderAgendaPdf } from '@/lib/export/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const viewSchema = z.enum(['day', 'week', 'month']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(request: NextRequest) {
  const { supabase, user, tenantId } = await requireTenant();
  const { searchParams } = new URL(request.url);

  const format = parseExportFormat(searchParams.get('format'), ['xlsx', 'pdf', 'docx']);
  if (!format) return exportErrorResponse('Formato inválido. Usá pdf, docx o xlsx.', 400);

  const viewParsed = viewSchema.safeParse(searchParams.get('view') || 'day');
  if (!viewParsed.success) return exportErrorResponse('Vista inválida.', 400);

  const dateParsed = dateSchema.safeParse(searchParams.get('date'));
  if (!dateParsed.success) return exportErrorResponse('Fecha inválida.', 400);

  const data = await fetchAgendaExportData(supabase, user.id, tenantId, user.email ?? null, viewParsed.data, dateParsed.data);

  let buffer: Buffer;
  try {
    if (format === 'xlsx') buffer = await buildAgendaWorkbook(data);
    else if (format === 'docx') buffer = await buildAgendaDocx(data);
    else buffer = await renderAgendaPdf(data);
  } catch (err) {
    logExportError(`agenda — vista ${viewParsed.data} — fecha ${dateParsed.data} — formato ${format}`, err);
    return exportErrorResponse('No pudimos generar el archivo. Intentá nuevamente.', 500);
  }

  const filename = buildExportFilename(['Agenda', viewParsed.data, dateParsed.data], format);
  return exportFileResponse(buffer, filename, format);
}
