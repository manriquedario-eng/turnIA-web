// Exportación del listado de pacientes del tenant actual — Excel o PDF
// (PARTE 8 del pedido: Word es opcional acá, no se implementa). Nunca
// incluye información clínica, sólo lo que ya se ve en /patients.

import { type NextRequest } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchPatientsListExportData } from '@/lib/export/authorize';
import { buildExportFilename } from '@/lib/export/filename';
import { exportErrorResponse, exportFileResponse, logExportError, parseExportFormat } from '@/lib/export/response';
import { buildPatientsListWorkbook } from '@/lib/export/xlsx/patients';
import { renderPatientsListPdf } from '@/lib/export/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { supabase, user, tenantId } = await requireTenant();
  const { searchParams } = new URL(request.url);
  const format = parseExportFormat(searchParams.get('format'), ['xlsx', 'pdf']);
  if (!format) return exportErrorResponse('Formato inválido. Usá xlsx o pdf.', 400);

  const data = await fetchPatientsListExportData(supabase, user.id, tenantId, user.email ?? null);

  let buffer: Buffer;
  try {
    buffer = format === 'xlsx' ? await buildPatientsListWorkbook(data) : await renderPatientsListPdf(data);
  } catch (err) {
    logExportError(`listado de pacientes — formato ${format}`, err);
    return exportErrorResponse('No pudimos generar el archivo. Intentá nuevamente.', 500);
  }

  const filename = buildExportFilename(['Pacientes'], format);
  return exportFileResponse(buffer, filename, format);
}
