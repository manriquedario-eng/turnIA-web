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

type RecipientDefaults = {
  billingEntityId: string | null;
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
  };
  appointments: AppointmentOption[];
  initialSelectedIds: string[];
  recipient: RecipientDefaults;
  arca: {
    pointOfSale: number;
    activityCode: string;
    activityDescription: string;
  };
  today: string;
  monthStart: string;
};

function dateInArgentina(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function buildDetail(count: number, patientName: string, dni: string | null) {
  const sessionText = count === 1 ? '1 sesión' : `${count || 1} sesiones`;
  return `${sessionText} de atención profesional – Paciente ${patientName}${dni ? ` – DNI ${dni}` : ''}`;
}

export function BillingDraftForm({
  patient,
  appointments,
  initialSelectedIds,
  recipient,
  arca,
  today,
  monthStart,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [detailDirty, setDetailDirty] = useState(false);
  const [detail, setDetail] = useState(
    buildDetail(initialSelectedIds.length, patient.name, patient.dni),
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

  function toggleAppointment(id: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...selectedIds, id]))
      : selectedIds.filter((value) => value !== id);

    setSelectedIds(next);

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
      setDetail(buildDetail(next.length, patient.name, patient.dni));
    }
  }

  return (
    <form action={createBillingInvoiceDraft} className="stack">
      <input type="hidden" name="patient_id" value={patient.id} />
      <input type="hidden" name="billing_entity_id" value={recipient.billingEntityId ?? ''} />

      <div className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>1. Sesiones a facturar</h2>
            <p className="text-helper" style={{ marginTop: 4 }}>
              Seleccioná una o varias sesiones ya realizadas. TurnIA evita incluir una sesión que ya esté en otro borrador o factura autorizada.
            </p>
          </div>
          <span className="badge badge-neutral">{selectedIds.length} seleccionadas</span>
        </div>

        {appointments.length === 0 ? (
          <p className="alert">No hay sesiones anteriores disponibles para este paciente.</p>
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
        <h2 style={{ marginTop: 0 }}>2. Receptor de la factura</h2>
        <p className="text-helper" style={{ marginTop: 0 }}>
          Normalmente será la obra social. Estos datos se copian al borrador para conservar el estado fiscal histórico de la factura.
        </p>

        <div className="form-grid">
          <label>
            Razón social
            <input name="recipient_legal_name" defaultValue={recipient.legalName} required maxLength={240} />
          </label>
          <label>
            CUIT
            <input name="recipient_cuit" defaultValue={recipient.cuit} inputMode="numeric" placeholder="11 dígitos" maxLength={14} />
          </label>
          <label>
            Condición frente al IVA
            <select
              name="recipient_vat_condition_id"
              defaultValue={recipient.vatConditionId ? String(recipient.vatConditionId) : ''}
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
            <input name="recipient_address" defaultValue={recipient.address} maxLength={240} />
          </label>
          <label>
            Email de facturación
            <input name="recipient_email" type="email" defaultValue={recipient.email} maxLength={200} />
          </label>
          <label>
            Condición de venta
            <select name="sale_condition" defaultValue={recipient.saleCondition || 'cuenta_corriente'}>
              {SALE_CONDITIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>3. Datos del comprobante</h2>
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
              Ejemplo: “4 sesiones de atención profesional – Paciente {patient.name}{patient.dni ? ` – DNI ${patient.dni}` : ''}”.
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>4. Guardar borrador</h2>
        <p className="text-helper" style={{ marginTop: 0 }}>
          Guardar el borrador <strong>no emite nada en ARCA</strong>. Después vas a ver una pantalla de revisión con el botón de emisión.
        </p>
        <button className="btn" type="submit">Guardar borrador y revisar</button>
      </div>
    </form>
  );
}
