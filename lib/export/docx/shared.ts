// Piezas reutilizadas por todos los documentos Word (.docx): encabezado con
// marca + título + datos del profesional + fecha de generación, y una tabla
// simple con encabezado sombreado. Antes esto vivía duplicado sólo en
// docx/patient.ts — se extrae acá para que agenda/patients/payments lo
// reutilicen sin repetir la lógica (pedido: "no duplicar lógica
// innecesaria... extraer helper común").

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
import type { ProfessionalInfo } from '../types';
import { formatExportDateTime } from '../format';

const HEADER_SHADING = { type: ShadingType.SOLID, color: 'EFE7DE', fill: 'EFE7DE' };

export function headerCell(text: string) {
  return new TableCell({
    shading: HEADER_SHADING,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })],
  });
}

export function bodyCell(text: string) {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })] });
}

export function simpleTable(headers: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map(headerCell), tableHeader: true }),
      ...rows.map((row) => new TableRow({ children: row.map(bodyCell) })),
    ],
  });
}

export function sectionHeading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
}

export function emptyNote(text = 'Sin información registrada.') {
  return new Paragraph({ text, spacing: { after: 100 } });
}

/**
 * Encabezado común (marca "TurnIA", título del documento, subtítulo
 * opcional — p. ej. el período de la agenda —, línea del profesional y
 * fecha de generación). Misma estructura que ya usaba la ficha de paciente,
 * ahora compartida por los cuatro documentos Word.
 */
export function buildDocHeader(
  title: string,
  professional: ProfessionalInfo,
  generatedAt: string,
  subtitle?: string,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: 'TurnIA', heading: HeadingLevel.HEADING_3, spacing: { after: 40 } }),
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      spacing: { after: subtitle ? 40 : 80 },
    }),
  ];

  if (subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: subtitle, size: 22, color: '3D3529' })],
        spacing: { after: 80 },
      }),
    );
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: [professional.displayName, professional.profession, professional.licenseNumber ? `Mat. ${professional.licenseNumber}` : null]
            .filter(Boolean)
            .join(' · '),
          size: 18,
          color: '6B6157',
        }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generado el ${formatExportDateTime(generatedAt)}`, size: 16, color: '928A7E' })],
      spacing: { after: 200 },
    }),
  );

  return children;
}

/** Empaqueta el documento final (mismo Packer.toBuffer que usaba patient.ts). */
export async function packDocument(title: string, children: (Paragraph | Table)[]): Promise<Buffer> {
  const doc = new Document({
    creator: 'TurnIA',
    title,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
