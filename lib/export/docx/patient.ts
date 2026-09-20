// Word (.docx) real de un paciente — PARTE 6 del pedido: documento editable,
// con títulos/subtítulos y tablas cuando corresponde, que abre bien en Word,
// LibreOffice y Word Online. Usa el paquete `docx` (genera OOXML real, no
// HTML renombrado).

import type { Paragraph, Table } from 'docx';
import type { PatientExportData, PatientExportSection } from '../types';
import { formatExportCurrency, formatExportDate, formatExportDateTime, textOrDash, textOrEmptyNote } from '../format';
import { modalityLabel, statusLabel, paymentMethodLabel } from '@/lib/labels';
import { buildDocHeader, emptyNote, packDocument, sectionHeading, simpleTable } from './shared';
import { Paragraph as DocxParagraph, TextRun } from 'docx';

export async function buildPatientDocx(data: PatientExportData, sections: Set<PatientExportSection>): Promise<Buffer> {
  const wantsAll = sections.has('full');
  const children: (Paragraph | Table)[] = buildDocHeader(`Ficha de ${data.patient.name}`, data.professional, data.generatedAt);

  if (wantsAll || sections.has('data')) {
    children.push(sectionHeading('Datos del paciente'));
    const p = data.patient;
    children.push(
      simpleTable(
        ['Campo', 'Valor'],
        [
          ['Nombre', textOrDash(p.name)],
          ['DNI', textOrDash(p.dni)],
          ['Teléfono', textOrDash(p.phone)],
          ['Email', textOrDash(p.email)],
          ['Obra social', textOrDash(p.insuranceName)],
          ['Nº afiliado', textOrDash(p.insuranceMemberNumber)],
          ['Plan', textOrDash(p.insurancePlan)],
          ['Lugar de atención', textOrDash(p.careLocation)],
          ['Precio habitual', p.defaultPrice != null ? formatExportCurrency(p.defaultPrice, 'ARS') : '—'],
        ],
      ),
    );

    children.push(sectionHeading('Resumen'));
    children.push(
      simpleTable(
        ['Campo', 'Valor'],
        [
          ['Próximo turno', formatExportDateTime(data.summary.nextAppointmentAt)],
          ['Último turno', formatExportDateTime(data.summary.lastAppointmentAt)],
          ['Saldo pendiente', formatExportCurrency(data.summary.pendingBalance, 'ARS')],
        ],
      ),
    );
  }

  if (wantsAll || sections.has('clinical')) {
    children.push(sectionHeading('Ficha clínica'));
    if (!data.clinicalRecord) {
      children.push(emptyNote());
    } else {
      const r = data.clinicalRecord;
      const block = (label: string, value: string | null) => [
        new DocxParagraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { before: 100 } }),
        new DocxParagraph({ text: textOrEmptyNote(value), spacing: { after: 60 } }),
      ];
      children.push(
        ...block('Motivo', r.reason),
        ...block('Antecedentes', r.background),
        ...block('Diagnóstico', r.diagnosis),
        ...block('Seguimiento', r.followUp),
        ...block('Notas', r.notes),
        ...block('Plan', r.plan),
      );
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: `Última actualización: ${formatExportDateTime(r.updatedAt)}`, italics: true, size: 18 })],
          spacing: { before: 100 },
        }),
      );
    }
  }

  if (wantsAll || sections.has('sessions')) {
    children.push(sectionHeading('Sesiones'));
    if (data.sessions.length === 0) {
      children.push(emptyNote());
    } else {
      children.push(
        simpleTable(
          ['Fecha', 'Servicio', 'Modalidad', 'Estado', 'Nota'],
          data.sessions.map((s) => [formatExportDate(s.date), textOrDash(s.service), modalityLabel(s.modality), statusLabel(s.status), textOrDash(s.note)]),
        ),
      );
    }
  }

  if (wantsAll || sections.has('followups')) {
    children.push(sectionHeading('Seguimientos'));
    if (data.followUps.length === 0) {
      children.push(emptyNote());
    } else {
      children.push(
        simpleTable(
          ['Fecha', 'Contenido'],
          data.followUps.map((f) => [formatExportDate(f.date), textOrDash(f.content)]),
        ),
      );
    }
  }

  if (wantsAll || sections.has('payments')) {
    children.push(sectionHeading('Pagos / estado de cuenta'));
    if (data.payments.length === 0) {
      children.push(emptyNote());
    } else {
      children.push(
        simpleTable(
          ['Fecha', 'Importe', 'Medio', 'Turno asociado'],
          data.payments.map((p) => [
            formatExportDate(p.date),
            formatExportCurrency(p.amount, p.currency),
            paymentMethodLabel(p.method),
            p.appointmentDate ? formatExportDate(p.appointmentDate) : '—',
          ]),
        ),
      );
    }
  }

  if (wantsAll || sections.has('activity')) {
    children.push(sectionHeading('Actividad'));
    if (data.activity.length === 0) {
      children.push(emptyNote());
    } else {
      children.push(
        simpleTable(
          ['Fecha', 'Tipo', 'Descripción', 'Detalle'],
          data.activity.map((a) => [formatExportDate(a.date), a.type, textOrDash(a.title), textOrDash(a.detail)]),
        ),
      );
    }
  }

  return packDocument(`Ficha de ${data.patient.name}`, children);
}
