// Word (.docx) real de un paciente — PARTE 6 del pedido: documento editable,
// con títulos/subtítulos y tablas cuando corresponde, que abre bien en Word,
// LibreOffice y Word Online. Usa el paquete `docx` (genera OOXML real, no
// HTML renombrado).

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { PatientExportData, PatientExportSection } from '../types';
import { formatExportCurrency, formatExportDate, formatExportDateTime, textOrDash, textOrEmptyNote } from '../format';
import { modalityLabel, statusLabel, paymentMethodLabel } from '@/lib/labels';

const HEADER_SHADING = { type: ShadingType.SOLID, color: 'EFE7DE', fill: 'EFE7DE' };

function headerCell(text: string) {
  return new TableCell({
    shading: HEADER_SHADING,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })],
  });
}

function bodyCell(text: string) {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })] });
}

function simpleTable(headers: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map(headerCell), tableHeader: true }),
      ...rows.map((row) => new TableRow({ children: row.map(bodyCell) })),
    ],
  });
}

export async function buildPatientDocx(data: PatientExportData, sections: Set<PatientExportSection>): Promise<Buffer> {
  const wantsAll = sections.has('full');
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({ text: 'TurnIA', heading: HeadingLevel.HEADING_3, spacing: { after: 40 } }),
    new Paragraph({
      children: [new TextRun({ text: `Ficha de ${data.patient.name}`, bold: true, size: 32 })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: [data.professional.displayName, data.professional.profession, data.professional.licenseNumber ? `Mat. ${data.professional.licenseNumber}` : null]
            .filter(Boolean)
            .join(' · '),
          size: 18,
          color: '6B6157',
        }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generado el ${formatExportDateTime(data.generatedAt)}`, size: 16, color: '928A7E' })],
      spacing: { after: 200 },
    }),
  );

  if (wantsAll || sections.has('data')) {
    children.push(new Paragraph({ text: 'Datos del paciente', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
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

    children.push(new Paragraph({ text: 'Resumen', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
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
    children.push(new Paragraph({ text: 'Ficha clínica', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    if (!data.clinicalRecord) {
      children.push(new Paragraph({ text: 'Sin información registrada.', spacing: { after: 100 } }));
    } else {
      const r = data.clinicalRecord;
      const block = (label: string, value: string | null) => [
        new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { before: 100 } }),
        new Paragraph({ text: textOrEmptyNote(value), spacing: { after: 60 } }),
      ];
      children.push(
        ...block('Motivo', r.reason),
        ...block('Antecedentes', r.background),
        ...block('Seguimiento', r.followUp),
        ...block('Notas', r.notes),
        ...block('Plan', r.plan),
      );
      children.push(new Paragraph({ children: [new TextRun({ text: `Última actualización: ${formatExportDateTime(r.updatedAt)}`, italics: true, size: 18 })], spacing: { before: 100 } }));
    }
  }

  if (wantsAll || sections.has('sessions')) {
    children.push(new Paragraph({ text: 'Sesiones', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    if (data.sessions.length === 0) {
      children.push(new Paragraph({ text: 'Sin información registrada.' }));
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
    children.push(new Paragraph({ text: 'Seguimientos', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    if (data.followUps.length === 0) {
      children.push(new Paragraph({ text: 'Sin información registrada.' }));
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
    children.push(new Paragraph({ text: 'Pagos / estado de cuenta', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    if (data.payments.length === 0) {
      children.push(new Paragraph({ text: 'Sin información registrada.' }));
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
    children.push(new Paragraph({ text: 'Actividad', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    if (data.activity.length === 0) {
      children.push(new Paragraph({ text: 'Sin información registrada.' }));
    } else {
      children.push(
        simpleTable(
          ['Fecha', 'Tipo', 'Descripción', 'Detalle'],
          data.activity.map((a) => [formatExportDate(a.date), a.type, textOrDash(a.title), textOrDash(a.detail)]),
        ),
      );
    }
  }

  const doc = new Document({
    creator: 'TurnIA',
    title: `Ficha de ${data.patient.name}`,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
