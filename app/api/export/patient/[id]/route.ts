// Exportación de un paciente puntual — PDF / Word / Excel, por sección o
// ficha completa (PARTE 3-4 del pedido de exportación).
//
// Seguridad (PARTE 2): requireTenant() exige sesión válida; el id de la URL
// nunca se usa "tal cual" — fetchPatientExportData vuelve a filtrar por
// tenant_id server-side y devuelve null si el paciente no existe, está
// archivado, o es de otro tenant, y en ese caso se responde 404 sin
// distinguir el motivo (mismo criterio que el resto de la app).

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchPatientExportData } from '@/lib/export/authorize';
import { buildExportFilename } from '@/lib/export/filename';
import { exportErrorResponse, exportFileResponse, logExportError, parseExportFormat } from '@/lib/export/response';
import type { PatientExportSection } from '@/lib/export/types';
import { buildPatientWorkbook } from '@/lib/export/xlsx/patient';
import { buildPatientDocx } from '@/lib/export/docx/patient';
import { renderPatientPdf } from '@/lib/export/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SECTION_SCHEMA = z.enum(['full', 'clinical', 'sessions', 'followups', 'activity', 'data', 'payments']);

const SECTION_LABEL: Record<PatientExportSection, string> = {
  full: 'Ficha_Completa',
  clinical: 'Ficha_Clinica',
  sessions: 'Sesiones',
  followups: 'Seguimientos',
  activity: 'Actividad',
  data: 'Datos',
  payments: 'Pagos',
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user, tenantId } = await requireTenant();
  const { id } = await params;

  const idCheck = z.string().uuid().safeParse(id);
  if (!idCheck.success) return exportErrorResponse('Paciente inválido.', 400);

  const { searchParams } = new URL(request.url);
  const format = parseExportFormat(searchParams.get('format'), ['pdf', 'docx', 'xlsx']);
  if (!format) return exportErrorResponse('Formato inválido. Usá pdf, docx o xlsx.', 400);

  const sectionParsed = SECTION_SCHEMA.safeParse(searchParams.get('section') || 'full');
  if (!sectionParsed.success) return exportErrorResponse('Sección inválida.', 400);
  const section = sectionParsed.data as PatientExportSection;
  const sections = new Set<PatientExportSection>([section]);

  const data = await fetchPatientExportData(supabase, user.id, tenantId, idCheck.data, user.email ?? null);
  if (!data) return exportErrorResponse('Paciente no encontrado.', 404);

  let buffer: Buffer;
  try {
    if (format === 'xlsx') buffer = await buildPatientWorkbook(data, sections);
    else if (format === 'docx') buffer = await buildPatientDocx(data, sections);
    else buffer = await renderPatientPdf(data, sections);
  } catch (err) {
    logExportError(`paciente ${idCheck.data} — sección ${section} — formato ${format}`, err);
    return exportErrorResponse('No pudimos generar el archivo. Intentá nuevamente.', 500);
  }

  const filename = buildExportFilename([data.patient.name, SECTION_LABEL[section]], format);
  return exportFileResponse(buffer, filename, format);
}
