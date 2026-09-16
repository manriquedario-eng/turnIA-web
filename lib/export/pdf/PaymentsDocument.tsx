import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { PaymentsExportData } from '../types';
import { formatExportCurrency, formatExportDate, textOrDash } from '../format';
import { paymentMethodLabel } from '@/lib/labels';
import { pdfStyles } from './styles';
import { DocFooter, DocHeader, SimpleTable, type PdfDocumentElement } from './shared';

export function PaymentsDocument({ data }: { data: PaymentsExportData }): PdfDocumentElement {
  const totalCollected = data.payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <Document title="Pagos y caja — TurnIA" author="TurnIA">
      <Page size="A4" style={pdfStyles.page} wrap>
        <DocHeader professional={data.professional} generatedAt={data.generatedAt} />
        <Text style={pdfStyles.title}>Pagos y caja</Text>
        <Text style={pdfStyles.subtitle}>Total cobrado en el período mostrado: {formatExportCurrency(totalCollected, 'ARS')}</Text>

        <View>
          <Text style={pdfStyles.sectionHeading}>Pagos</Text>
          <SimpleTable
            columns={[
              { label: 'Fecha', width: 16 },
              { label: 'Paciente', width: 28 },
              { label: 'Medio', width: 22 },
              { label: 'Importe', width: 18 },
              { label: 'Turno', width: 16 },
            ]}
            rows={data.payments.map((p) => [
              formatExportDate(p.date),
              textOrDash(p.patientName),
              paymentMethodLabel(p.method),
              formatExportCurrency(p.amount, p.currency),
              p.appointmentDate ? formatExportDate(p.appointmentDate) : '—',
            ])}
            emptyLabel="No hay pagos registrados."
          />
        </View>

        <View>
          <Text style={pdfStyles.sectionHeading}>Caja manual</Text>
          <SimpleTable
            columns={[
              { label: 'Fecha', width: 18 },
              { label: 'Tipo', width: 16 },
              { label: 'Concepto', width: 40 },
              { label: 'Importe', width: 26 },
            ]}
            rows={data.cashMovements.map((c) => [
              formatExportDate(c.date),
              c.kind === 'in' ? 'Ingreso' : 'Egreso',
              textOrDash(c.concept),
              formatExportCurrency(c.amount, 'ARS'),
            ])}
            emptyLabel="No hay movimientos manuales de caja."
          />
        </View>

        <DocFooter />
      </Page>
    </Document>
  );
}
