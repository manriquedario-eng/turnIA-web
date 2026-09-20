import { Document, Page, Text } from '@react-pdf/renderer';
import type { PatientsListExportData } from '../types';
import { formatExportCurrency, formatExportDateTime, textOrDash } from '../format';
import { pdfStyles } from './styles';
import { DocFooter, DocHeader, SimpleTable, type PdfDocumentElement } from './shared';

export function PatientsListDocument({ data }: { data: PatientsListExportData }): PdfDocumentElement {
  return (
    <Document title="Pacientes — TurnIA" author="TurnIA">
      <Page size="A4" orientation="landscape" style={pdfStyles.page} wrap>
        <DocHeader professional={data.professional} generatedAt={data.generatedAt} />
        <Text style={pdfStyles.title}>Pacientes</Text>
        <Text style={pdfStyles.subtitle}>{data.rows.length} paciente{data.rows.length === 1 ? '' : 's'} activo{data.rows.length === 1 ? '' : 's'}</Text>
        <SimpleTable
          columns={[
            { label: 'Nombre', width: 20 },
            { label: 'Teléfono', width: 13 },
            { label: 'Email', width: 18 },
            { label: 'DNI', width: 10 },
            { label: 'Obra social', width: 15 },
            { label: 'Próximo turno', width: 14 },
            { label: 'Saldo', width: 10 },
          ]}
          rows={data.rows.map((r) => [
            r.name,
            textOrDash(r.phone),
            textOrDash(r.email),
            textOrDash(r.dni),
            textOrDash(r.insuranceName),
            r.nextAppointmentAt ? formatExportDateTime(r.nextAppointmentAt) : 'Sin turno',
            formatExportCurrency(r.pendingBalance, 'ARS'),
          ])}
          emptyLabel="No hay pacientes cargados."
        />
        <DocFooter />
      </Page>
    </Document>
  );
}
