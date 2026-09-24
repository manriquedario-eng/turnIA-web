// Exportación del listado de pacientes del tenant actual — Excel, PDF o
// Word (Word agregado en la pasada de corrección de PARTE 4). Nunca incluye
// información clínica, sólo lo que ya se ve en /patients.

import { type NextRequest } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchPatientsListExportData, PatientsExportTooLargeError } from '@/lib/export/authorize';
import { buildExportFilename } from '@/lib/export/filename';
import { exportErrorResponse, exportFileResponse, logExportError, parseExportFormat } from '@/lib/export/response';
import { buildPatientsListWorkbook } from '@/lib/export/xlsx/patients';
import { buildPatientsListDocx } from '@/lib/export/docx/patients';
import { renderPatientsListPdf } from '@/lib/export/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { supabase, user, tenantId } = await requireTenant();
  const { searchParams } = new URL(request.url);
  const format = parseExportFormat(searchParams.get('format'), ['xlsx', 'pdf', 'docx']);
  if (!format) return exportErrorResponse('Formato inválido. Usá pdf, docx o xlsx.', 400);

  let data;
  try {
    data = await fetchPatientsListExportData(supabase, user.id, tenantId, user.email ?? null);
  } catch (err) {
    if (err instanceof PatientsExportTooLargeError) {
      return exportErrorResponse(err.message, 400);
    }
    logExportError('listado de pacientes — lectura de datos', err);
    return exportErrorResponse('No pudimos leer los datos para exportar. Intentá nuevamente.', 500);
  }

  let buffer: Buffer;
  try {
    if (format === 'xlsx') buffer = await buildPatientsListWorkbook(data);
    else if (format === 'docx') buffer = await buildPatientsListDocx(data);
    else buffer = await renderPatientsListPdf(data);
  } catch (err) {
    logExportError(`listado de pacientes — formato ${format}`, err);
    return exportErrorResponse('No pudimos generar el archivo. Intentá nuevamente.', 500);
  }

  const filename = buildExportFilename(['Pacientes'], format);
  return exportFileResponse(buffer, filename, format);
}
