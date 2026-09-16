import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { PatientExportData, PatientExportSection } from '../types';
import { formatExportCurrency, formatExportDate, formatExportDateTime, textOrDash, textOrEmptyNote } from '../format';
import { modalityLabel, statusLabel, paymentMethodLabel } from '@/lib/labels';
import { pdfStyles } from './styles';
import { DocFooter, DocHeader, SimpleTable, type PdfDocumentElement } from './shared';

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={pdfStyles.fieldRow}>
      <Text style={pdfStyles.fieldLabel}>{label}</Text>
      <Text style={pdfStyles.fieldValue}>{value}</Text>
    </View>
  );
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <View wrap={false}>
      <Text style={pdfStyles.paragraphLabel}>{label}</Text>
      <Text style={pdfStyles.paragraphValue}>{textOrEmptyNote(value)}</Text>
    </View>
  );
}

export function PatientDocument({ data, sections }: { data: PatientExportData; sections: Set<PatientExportSection> }): PdfDocumentElement {
  const wantsAll = sections.has('full');
  const p = data.patient;

  return (
    <Document title={`Ficha de ${p.name} — TurnIA`} author="TurnIA">
      <Page size="A4" style={pdfStyles.page} wrap>
        <DocHeader professional={data.professional} generatedAt={data.generatedAt} />

        <Text style={pdfStyles.title}>{p.name}</Text>
        <Text style={pdfStyles.subtitle}>Ficha de paciente</Text>

        {(wantsAll || sections.has('data')) && (
          <View wrap={false}>
            <Text style={pdfStyles.sectionHeading}>Datos del paciente</Text>
            <FieldRow label="DNI" value={textOrDash(p.dni)} />
            <FieldRow label="Teléfono" value={textOrDash(p.phone)} />
            <FieldRow label="Email" value={textOrDash(p.email)} />
            <FieldRow label="Obra social" value={textOrDash(p.insuranceName)} />
            <FieldRow label="Nº afiliado" value={textOrDash(p.insuranceMemberNumber)} />
            <FieldRow label="Plan" value={textOrDash(p.insurancePlan)} />
            <FieldRow label="Lugar de atención" value={textOrDash(p.careLocation)} />
            <FieldRow label="Precio habitual" value={p.defaultPrice != null ? formatExportCurrency(p.defaultPrice, 'ARS') : '—'} />
          </View>
        )}

        {(wantsAll || sections.has('data')) && (
          <View wrap={false}>
            <Text style={pdfStyles.sectionHeading}>Resumen</Text>
            <FieldRow label="Próximo turno" value={formatExportDateTime(data.summary.nextAppointmentAt)} />
            <FieldRow label="Último turno" value={formatExportDateTime(data.summary.lastAppointmentAt)} />
            <FieldRow label="Saldo pendiente" value={formatExportCurrency(data.summary.pendingBalance, 'ARS')} />
          </View>
        )}

        {(wantsAll || sections.has('clinical')) && (
          <View>
            <Text style={pdfStyles.sectionHeading}>Ficha clínica</Text>
            {!data.clinicalRecord ? (
              <Text style={pdfStyles.emptyNote}>Sin información registrada.</Text>
            ) : (
              <>
                <TextBlock label="Motivo" value={data.clinicalRecord.reason} />
                <TextBlock label="Antecedentes" value={data.clinicalRecord.background} />
                <TextBlock label="Seguimiento" value={data.clinicalRecord.followUp} />
                <TextBlock label="Notas" value={data.clinicalRecord.notes} />
                <TextBlock label="Plan" value={data.clinicalRecord.plan} />
                <Text style={[pdfStyles.emptyNote, { marginTop: 6 }]}>
                  Última actualización: {formatExportDateTime(data.clinicalRecord.updatedAt)}
                </Text>
              </>
            )}
          </View>
        )}

        {(wantsAll || sections.has('sessions')) && (
          <View>
            <Text style={pdfStyles.sectionHeading}>Sesiones</Text>
            <SimpleTable
              columns={[
                { label: 'Fecha', width: 14 },
                { label: 'Servicio', width: 20 },
                { label: 'Modalidad', width: 14 },
                { label: 'Estado', width: 14 },
                { label: 'Nota', width: 38 },
              ]}
              rows={data.sessions.map((s) => [formatExportDate(s.date), textOrDash(s.service), modalityLabel(s.modality), statusLabel(s.status), textOrDash(s.note)])}
            />
          </View>
        )}

        {(wantsAll || sections.has('followups')) && (
          <View>
            <Text style={pdfStyles.sectionHeading}>Seguimientos</Text>
            <SimpleTable
              columns={[
                { label: 'Fecha', width: 18 },
                { label: 'Contenido', width: 82 },
              ]}
              rows={data.followUps.map((f) => [formatExportDate(f.date), textOrDash(f.content)])}
            />
          </View>
        )}

        {(wantsAll || sections.has('payments')) && (
          <View>
            <Text style={pdfStyles.sectionHeading}>Pagos / estado de cuenta</Text>
            <SimpleTable
              columns={[
                { label: 'Fecha', width: 18 },
                { label: 'Importe', width: 22 },
                { label: 'Medio', width: 30 },
                { label: 'Turno asociado', width: 30 },
              ]}
              rows={data.payments.map((pmt) => [
                formatExportDate(pmt.date),
                formatExportCurrency(pmt.amount, pmt.currency),
                paymentMethodLabel(pmt.method),
                pmt.appointmentDate ? formatExportDate(pmt.appointmentDate) : '—',
              ])}
            />
          </View>
        )}

        {(wantsAll || sections.has('activity')) && (
          <View>
            <Text style={pdfStyles.sectionHeading}>Actividad</Text>
            <SimpleTable
              columns={[
                { label: 'Fecha', width: 16 },
                { label: 'Tipo', width: 14 },
                { label: 'Descripción', width: 35 },
                { label: 'Detalle', width: 35 },
              ]}
              rows={data.activity.map((a) => [formatExportDate(a.date), a.type, textOrDash(a.title), textOrDash(a.detail)])}
            />
          </View>
        )}

        <DocFooter />
      </Page>
    </Document>
  );
}
