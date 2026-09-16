import { Document, Page, Text } from '@react-pdf/renderer';
import type { AgendaExportData } from '../types';
import { formatExportDate, formatExportTime, textOrDash } from '../format';
import { modalityLabel, statusLabel } from '@/lib/labels';
import { pdfStyles } from './styles';
import { DocFooter, DocHeader, SimpleTable, type PdfDocumentElement } from './shared';

export function AgendaDocument({ data }: { data: AgendaExportData }): PdfDocumentElement {
  return (
    <Document title="Agenda — TurnIA" author="TurnIA">
      <Page size="A4" style={pdfStyles.page} wrap>
        <DocHeader professional={data.professional} generatedAt={data.generatedAt} />
        <Text style={pdfStyles.title}>Agenda</Text>
        <Text style={pdfStyles.subtitle}>{data.periodLabel}</Text>
        <SimpleTable
          columns={[
            { label: 'Fecha', width: 14 },
            { label: 'Inicio', width: 10 },
            { label: 'Fin', width: 10 },
            { label: 'Paciente', width: 24 },
            { label: 'Servicio', width: 20 },
            { label: 'Modalidad', width: 12 },
            { label: 'Estado', width: 10 },
          ]}
          rows={data.rows.map((r) => [
            formatExportDate(r.startTime),
            formatExportTime(r.startTime),
            formatExportTime(r.endTime),
            textOrDash(r.patientName),
            textOrDash(r.service),
            modalityLabel(r.modality),
            statusLabel(r.status),
          ])}
          emptyLabel="No hay turnos en este período."
        />
        <DocFooter />
      </Page>
    </Document>
  );
}
