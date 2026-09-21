'use client';

import { useMemo, useState } from 'react';
import { createBillingInvoiceDraft } from '@/app/(protected)/billing/actions';
import { SALE_CONDITIONS, VAT_CONDITIONS } from '@/lib/billing/constants';

type AppointmentOption = {
  id: string;
  startsAt: string;
  serviceName: string;
  amount: number | null;
};

type PayerOption = {
  id: string;
  displayName: string;
  legalName: string;
  cuit: string;
  vatConditionId: number | null;
  address: string;
  email: string;
  saleCondition: string;
};

type Props = {
  patient: {
    id: string;
    name: string;
    dni: string | null;
    defaultPrice: number | null;
    insuranceName: string | null;
    insuranceMemberNumber: string | null;
    insurancePlan: string | null;
    fiscalCuit: string | null;
    fiscalVatConditionId: number | null;
    fiscalAddress: string | null;
    fiscalEmail: string | null;
  };
  payers: PayerOption[];
  defaultPayerId: string | null;
  appointments: AppointmentOption[];
  initialSelectedIds: string[];
  arca: {
    pointOfSale: number;
    activityCode: string;
    activityDescription: string;
  };
  today: string;
  monthStart: string;
};

type RecipientMode = 'patient_reimbursement' | 'direct_payer';

function dateInArgentina(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function buildDetail(
  mode: RecipientMode,
  count: number,
  patient: Props['patient'],
) {
  const sessionText = count === 1 ? '1 sesión' : `${count || 1} sesiones`;
  const parts = [`${sessionText} de atención profesional`];

  if (mode === 'patient_reimbursement') {
    if (patient.insuranceName) parts.push(`Obra social ${patient.insuranceName}`);
    if (patient.insuranceMemberNumber) parts.push(`Afiliado Nº ${patient.insuranceMemberNumber}`);
    if (patient.insurancePlan) parts.push(`Plan ${patient.insurancePlan}`);
    parts.push(`Paciente ${patient.name}`);
    if (patient.dni) parts.push(`DNI ${patient.dni}`);
  } else {
    parts.push(`Paciente ${patient.name}`);
    if (patient.dni) parts.push(`DNI ${patient.dni}`);
    if (patient.insuranceMemberNumber) parts.push(`Afiliado Nº ${patient.insuranceMemberNumber}`);
  }

  return parts.join(' – ');
}

export function BillingDraftForm({
  patient,
  payers,
  defaultPayerId,
  appointments,
  initialSelectedIds,
  arca,
  today,
  monthStart,
}: Props) {
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('patient_reimbursement');
  const [selectedPayerId, setSelectedPayerId] = useState(defaultPayerId ?? '');
  const defaultPayer = payers.find((payer) => payer.id === defaultPayerId) ?? null;

  const [recipientLegalName, setRecipientLegalName] = useState(patient.name);
  const [recipientCuit, setRecipientCuit] = useState(patient.fiscalCuit ?? '');
  const [recipientVatConditionId, setRecipientVatConditionId] = useState(
    String(patient.fiscalVatConditionId ?? 5),
  );
  const [recipientAddress, setRecipientAddress] = useState(patient.fiscalAddress ?? '');
  const [recipientEmail, setRecipientEmail] = useState(patient.fiscalEmail ?? '');
  const [saleCondition, setSaleCondition] = useState('contado');

  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [sessionCount, setSessionCount] = useState(
    Math.max(initialSelectedIds.length, 1),
  );
  const [detailDirty, setDetailDirty] = useState(false);
  const [detail, setDetail] = useState(
    buildDetail('patient_reimbursement', Math.max(initialSelectedIds.length, 1), patient),
  );

  const selectedAppointments = useMemo(
    () => appointments.filter((appointment) => selectedIds.includes(appointment.id)),
    [appointments, selectedIds],
  );

  const derivedTotal = useMemo(() => {
    if (selectedAppointments.length === 0) return patient.defaultPrice ?? 0;
    const amounts = selectedAppointments.map((item) => item.amount ?? patient.defaultPrice ?? 0);
    return Math.round(amounts.reduce((sum, amount) => sum + Number(amount || 0), 0) * 100) / 100;
  }, [selectedAppointments, patient.defaultPrice]);

  const selectedDates = selectedAppointments.map((item) => dateInArgentina(item.startsAt)).sort();
  const derivedFrom = selectedDates[0] ?? monthStart;
  const derivedTo = selectedDates[selectedDates.length - 1] ?? today;

  const [total, setTotal] = useState(String(derivedTotal || ''));
  const [serviceFrom, setServiceFrom] = useState(derivedFrom);
  const [serviceTo, setServiceTo] = useState(derivedTo);

  function applyPayer(payerId: string) {
    setSelectedPayerId(payerId);
    const payer = payers.find((item) => item.id === payerId);
    if (!payer) return;

    setRecipientLegalName(payer.legalName || payer.displayName);
    setRecipientCuit(payer.cuit);
    setRecipientVatConditionId(payer.vatConditionId ? String(payer.vatConditionId) : '');
    setRecipientAddress(payer.address);
    setRecipientEmail(payer.email);
    setSaleCondition(payer.saleCondition || 'cuenta_corriente');
  }

  function changeMode(mode: RecipientMode) {
    setRecipientMode(mode);

    if (mode === 'patient_reimbursement') {
      setRecipientLegalName(patient.name);
      setRecipientCuit(patient.fiscalCuit ?? '');
      setRecipientVatConditionId(String(patient.fiscalVatConditionId ?? 5));
      setRecipientAddress(patient.fiscalAddress ?? '');
      setRecipientEmail(patient.fiscalEmail ?? '');
      setSaleCondition('contado');
    } else if (defaultPayer) {
      applyPayer(defaultPayer.id);
    } else {
      setRecipientLegalName('');
      setRecipientCuit('');
      setRecipientVatConditionId('');
      setRecipientAddress('');
      setRecipientEmail('');
      setSaleCondition('cuenta_corriente');
    }

    if (!detailDirty) {
      setDetail(buildDetail(mode, sessionCount, patient));
    }
  }

  function toggleAppointment(id: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...selectedIds, id]))
      : selectedIds.filter((value) => value !== id);

    setSelectedIds(next);

    if (next.length > 0) {
      setSessionCount(next.length);
    }

    const nextAppointments = appointments.filter((appointment) => next.includes(appointment.id));
    const nextAmounts = nextAppointments.map((item) => item.amount ?? patient.defaultPrice ?? 0);
    const nextTotal =
      nextAppointments.length > 0
        ? Math.round(nextAmounts.reduce((sum, amount) => sum + Number(amount || 0), 0) * 100) / 100
        : patient.defaultPrice ?? 0;

    setTotal(String(nextTotal || ''));

    const dates = nextAppointments.map((item) => dateInArgentina(item.startsAt)).sort();
    setServiceFrom(dates[0] ?? monthStart);
    setServiceTo(dates[dates.length - 1] ?? today);

    if (!detailDirty) {
      setDetail(buildDetail(recipientMode, next.length > 0 ? next.length : sessionCount, patient));
    }
  }

  return (
    <form action={createBillingInvoiceDraft} className="stack">
      <input type="hidden" name="patient_id" value={patient.id} />
      <input type="hidden" name="recipient_mode" value={recipientMode} />
      <input
        type="hidden"
        name="billing_entity_id"
        value={recipientMode === 'direct_payer' ? selectedPayerId : ''}
      />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>1. ¿A quién se factura?</h2>
        <p className="text-helper" style={{ marginTop: 0 }}>
          Elegí el circuito. La obra social puede ser el receptor fiscal o solamente figurar en el detalle para un reintegro.
        </p>

        <div className="form-grid">
          <label
            className="checkbox-field"
            style={{ padding: 14, border: '1px solid var(--border, #e5e7eb)', borderRadius: 12 }}
          >
            <input
              type="radio"
              name="recipient_mode_selector"
              checked={recipientMode === 'patient_reimbursement'}
              onChange={() => changeMode('patient_reimbursement')}
            />
            <span>
              <strong>Al paciente / particular</strong><br />
              <span className="text-helper">Factura a nombre del paciente para que la presente a su obra social y solicite reintegro.</span>
            </span>
          </label>

          <label
            className="checkbox-field"
            style={{ padding: 14, border: '1px solid var(--border, #e5e7eb)', borderRadius: 12 }}
          >
            <input
              type="radio"
              name="recipient_mode_selector"
              checked={recipientMode === 'direct_payer'}
              onChange={() => changeMode('direct_payer')}
            />
            <span>
              <strong>A obra social / empresa</strong><br />
              <span className="text-helper">El profesional factura directamente a la institución.</span>
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>2. Sesiones a facturar</h2>
            <p className="text-helper" style={{ marginTop: 4 }}>
              Seleccioná una o varias sesiones ya realizadas. TurnIA evita incluir una sesión que ya esté en otro borrador o factura autorizada.
            </p>
          </div>
          <span className="badge badge-neutral">{selectedIds.length} turnos vinculados</span>
        </div>

        <div className="form-grid" style={{ marginBottom: 14 }}>
          <label>
            Cantidad de sesiones a facturar
            <input
              name="session_count"
              type="number"
              min="1"
              max="100"
              step="1"
              value={sessionCount}
              onChange={(event) => {
                const nextCount = Math.max(1, Number(event.target.value || 1));
                setSessionCount(nextCount);
                if (!detailDirty) {
                  setDetail(buildDetail(recipientMode, nextCount, patient));
                }
              }}
              required
            />
            <span className="field-hint">
              Podés escribir la cantidad aunque no selecciones turnos específicos.
            </span>
          </label>
        </div>

        {appointments.length === 0 ? (
          <p className="alert">
            No hay turnos anteriores disponibles para vincular. Igual podés facturar indicando la cantidad de sesiones arriba.
          </p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {appointments.map((appointment) => {
              const checked = selectedIds.includes(appointment.id);
              return (
                <label
                  key={appointment.id}
                  className="checkbox-field"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 12px',
                    border: '1px solid var(--border, #e5e7eb)',
                    borderRadius: 10,
                  }}
                >
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      name="appointment_ids"
                      value={appointment.id}
                      checked={checked}
                      onChange={(event) => toggleAppointment(appointment.id, event.target.checked)}
                    />
                    <span>
                      <strong>{new Date(appointment.startsAt).toLocaleDateString('es-AR')}</strong>
                      {' · '}
                      {appointment.serviceName}
                    </span>
                  </span>
                  <span className="muted">
                    {appointment.amount != null
                      ? `$ ${Number(appointment.amount).toLocaleString('es-AR')}`
                      : 'Sin importe'}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>3. Receptor fiscal</h2>

        {recipientMode === 'patient_reimbursement' ? (
          <p className="alert" style={{ marginTop: 0 }}>
            Receptor: <strong>{patient.name}</strong>. La obra social
            {patient.insuranceName ? <> <strong>{patient.insuranceName}</strong></> : null}
            {' '}se usa como dato de cobertura/reintegro y no como receptor fiscal.
          </p>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <label>
              Obra social / empresa
              <select value={selectedPayerId} onChange={(event) => applyPayer(event.target.value)}>
                <option value="">Completar receptor manualmente</option>
                {payers.map((payer) => (
                  <option key={payer.id} value={payer.id}>
                    {payer.displayName}{payer.cuit ? ` · CUIT ${payer.cuit}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="form-grid">
          <label>
            Nombre / Razón social
            <input
              name="recipient_legal_name"
              value={recipientLegalName}
              onChange={(event) => setRecipientLegalName(event.target.value)}
              required
              maxLength={240}
            />
          </label>
          <label>
            CUIT
            <input
              name="recipient_cuit"
              value={recipientCuit}
              onChange={(event) => setRecipientCuit(event.target.value)}
              inputMode="numeric"
              placeholder={recipientMode === 'patient_reimbursement' ? 'Opcional si se factura con DNI' : '11 dígitos'}
              maxLength={14}
            />
          </label>
          <label>
            Condición frente al IVA
            <select
              name="recipient_vat_condition_id"
              value={recipientVatConditionId}
              onChange={(event) => setRecipientVatConditionId(event.target.value)}
              required
            >
              <option value="" disabled>Seleccionar...</option>
              {VAT_CONDITIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            Domicilio comercial / fiscal
            <input
              name="recipient_address"
              value={recipientAddress}
              onChange={(event) => setRecipientAddress(event.target.value)}
              maxLength={240}
            />
          </label>
          <label>
            Email de facturación
            <input
              name="recipient_email"
              type="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            Condición de venta
            <select name="sale_condition" value={saleCondition} onChange={(event) => setSaleCondition(event.target.value)}>
              {SALE_CONDITIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>4. Datos del comprobante</h2>
        <div className="form-grid">
          <label>
            Fecha del comprobante
            <input name="issue_date" type="date" defaultValue={today} required />
          </label>
          <label>
            Período desde
            <input
              name="service_from"
              type="date"
              value={serviceFrom}
              onChange={(event) => setServiceFrom(event.target.value)}
              required
            />
          </label>
          <label>
            Período hasta
            <input
              name="service_to"
              type="date"
              value={serviceTo}
              onChange={(event) => setServiceTo(event.target.value)}
              required
            />
          </label>
          <label>
            Vencimiento para el pago
            <input name="due_date" type="date" defaultValue={today} required />
          </label>
          <label>
            Importe total (ARS)
            <input
              name="total"
              type="number"
              min="0.01"
              step="0.01"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              required
            />
          </label>
          <label>
            Punto de venta
            <input name="point_of_sale" type="number" min="1" defaultValue={arca.pointOfSale} required />
          </label>
          <label>
            Código de actividad ARCA
            <input name="activity_code" defaultValue={arca.activityCode} maxLength={40} />
          </label>
          <label>
            Actividad
            <input name="activity_description" defaultValue={arca.activityDescription} maxLength={240} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Detalle
            <textarea
              name="detail"
              value={detail}
              onChange={(event) => {
                setDetailDirty(true);
                setDetail(event.target.value);
              }}
              rows={4}
              minLength={2}
              maxLength={2000}
              required
            />
            <span className="field-hint">
              El detalle es editable antes de guardar el borrador.
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>5. Guardar borrador</h2>
        <p className="text-helper" style={{ marginTop: 0 }}>
          Guardar el borrador <strong>no emite nada en ARCA</strong>. Después vas a ver una pantalla de revisión con el botón de emisión.
        </p>
        <button className="btn" type="submit">Guardar borrador y revisar</button>
      </div>
    </form>
  );
}
