// Piezas reutilizadas por todos los documentos PDF: encabezado con marca +
// datos del profesional, pie de página con numeración, y una tabla simple
// de columnas con ancho relativo (react-pdf no trae un componente Table).

import { Document, Text, View } from '@react-pdf/renderer';
import type { ComponentProps, ReactElement } from 'react';
import type { ProfessionalInfo } from '../types';
import { formatExportDateTime } from '../format';
import { pdfStyles } from './styles';

// Tipo exacto que espera renderToBuffer/renderToStream/pdf() de
// @react-pdf/renderer: un ReactElement cuyas props son las de <Document>.
// Lo derivamos de ComponentProps<typeof Document> (en vez de importar un
// tipo "DocumentProps" que puede no estar exportado con ese nombre exacto
// según la versión) para que cada documento raíz (PatientDocument,
// PatientsListDocument, PaymentsDocument, AgendaDocument) declare su tipo
// de retorno real y así renderToBuffer(...) reciba el tipo correcto sin
// necesidad de "as any".
export type PdfDocumentElement = ReactElement<ComponentProps<typeof Document>>;

export function DocHeader({ professional, generatedAt }: { professional: ProfessionalInfo; generatedAt: string }) {
  const professionalLine = [professional.displayName, professional.profession].filter(Boolean).join(' · ');
  const subLineParts = [
    professional.licenseNumber ? `Mat. ${professional.licenseNumber}` : null,
    professional.professionalCollege,
    professional.officeAddress,
    professional.professionalPhone,
    professional.professionalEmail,
  ].filter(Boolean);

  return (
    <View>
      <View style={pdfStyles.brandRow}>
        <Text style={pdfStyles.brand}>TurnIA</Text>
        <Text style={pdfStyles.generatedAt}>Generado el {formatExportDateTime(generatedAt)}</Text>
      </View>
      <Text style={pdfStyles.professionalLine}>{professionalLine}</Text>
      {subLineParts.length > 0 ? <Text style={pdfStyles.professionalSubLine}>{subLineParts.join(' · ')}</Text> : null}
      <View style={pdfStyles.divider} />
    </View>
  );
}

export function DocFooter() {
  return (
    <Text
      style={pdfStyles.footer}
      fixed
      render={({ pageNumber, totalPages }) => `TurnIA · Documento generado automáticamente — página ${pageNumber} de ${totalPages}`}
    />
  );
}

export function SimpleTable({
  columns,
  rows,
  emptyLabel = 'Sin información registrada.',
}: {
  columns: { label: string; width: number }[];
  rows: string[][];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <Text style={pdfStyles.emptyNote}>{emptyLabel}</Text>;
  }
  return (
    <View style={pdfStyles.table}>
      <View style={pdfStyles.tableHeaderRow} fixed>
        {columns.map((col) => (
          <Text key={col.label} style={[pdfStyles.tableCellHeader, { width: `${col.width}%` }]}>
            {col.label}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <View style={pdfStyles.tableRow} key={i} wrap={false}>
          {row.map((cell, j) => (
            // eslint-disable-next-line react/no-array-index-key
            <Text key={j} style={[pdfStyles.tableCell, { width: `${columns[j].width}%` }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
