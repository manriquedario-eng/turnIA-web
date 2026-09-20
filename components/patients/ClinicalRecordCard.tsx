'use client';

import { useState } from 'react';

export type ClinicalRecordData = {
  reason: string | null;
  background: string | null;
  diagnosis: string | null;
  plan: string | null;
  notes: string | null;
} | null;

/**
 * Ficha clínica: si todavía no hay nada cargado, muestra un estado
 * compacto ("Todavía no hay información clínica registrada" + un botón)
 * en vez de cuatro textareas enormes vacíos de entrada. Si ya hay ficha,
 * la muestra en modo lectura (legible, sin inputs) con un botón "Editar
 * ficha clínica" que recién ahí abre el formulario. El server action
 * (`upsertPatientRecord`) no cambia — sigue siendo el mismo `action` prop.
 */
export function ClinicalRecordCard({
  patientId,
  record,
  action,
}: {
  patientId: string;
  record: ClinicalRecordData;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(!record);

  if (!editing) {
    if (!record) {
      return (
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Todavía no hay información clínica registrada.</p>
          <div>
            <button type="button" className="btn" onClick={() => setEditing(true)}>Completar ficha clínica</button>
          </div>
        </div>
      );
    }

    // Segunda pasada de rediseño: en vez de una secuencia de campos
    // idénticos, se agrupan en 3 bloques con jerarquía real (Consulta /
    // Diagnóstico / Seguimiento) — mismo contenido y mismos campos, sólo
    // cambia la presentación. Diagnóstico se destaca con un acento lateral
    // (mismo lenguaje visual que .dashboard-next-strip / .appointment-card.is-next),
    // no una card nueva — sigue siendo texto plano dentro de la ficha.
    const consultaFields: Array<[string, string | null]> = [
      ['Motivo de consulta', record.reason],
      ['Antecedentes', record.background],
    ];
    const seguimientoFields: Array<[string, string | null]> = [
      ['Plan / indicaciones', record.plan],
      ['Notas generales', record.notes],
    ];

    return (
      <div className="clinical-record-view">
        <div className="clinical-group">
          <div className="clinical-group-title">Consulta</div>
          {consultaFields.map(([label, value]) => (
            <div key={label} className="clinical-field">
              <span className="clinical-field-label">{label}</span>
              <p className="clinical-field-value">{value || <span className="muted">Sin datos</span>}</p>
            </div>
          ))}
        </div>

        <div className="clinical-group">
          <div className="clinical-field clinical-field-diagnosis">
            <span className="clinical-field-label">Diagnóstico</span>
            <p className="clinical-field-value">{record.diagnosis || <span className="muted">Sin diagnóstico registrado</span>}</p>
          </div>
        </div>

        <div className="clinical-group">
          <div className="clinical-group-title">Seguimiento</div>
          {seguimientoFields.map(([label, value]) => (
            <div key={label} className="clinical-field">
              <span className="clinical-field-label">{label}</span>
              <p className="clinical-field-value">{value || <span className="muted">Sin datos</span>}</p>
            </div>
          ))}
        </div>

        <div>
          <button type="button" className="btn secondary" onClick={() => setEditing(true)}>Editar ficha clínica</button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="clinical-record-form">
      <input type="hidden" name="patientId" value={patientId} />

      <div className="clinical-group">
        <div className="clinical-group-title">Consulta</div>
        <label>
          Motivo de consulta
          <textarea name="reason" defaultValue={record?.reason ?? ''} rows={2} maxLength={10000} style={{ width: '100%' }} />
        </label>
        <label>
          Antecedentes
          <textarea name="background" defaultValue={record?.background ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
        </label>
      </div>

      <div className="clinical-group">
        <label className="clinical-field-diagnosis-input">
          Diagnóstico
          <textarea name="diagnosis" defaultValue={record?.diagnosis ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
        </label>
      </div>

      <div className="clinical-group">
        <div className="clinical-group-title">Seguimiento</div>
        <label>
          Plan / indicaciones
          <textarea name="plan" defaultValue={record?.plan ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
        </label>
        <label>
          Notas generales
          <textarea name="notes" defaultValue={record?.notes ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
        </label>
      </div>

      <div className="nav">
        <button className="btn" type="submit">{record ? 'Guardar cambios' : 'Completar ficha clínica'}</button>
        {record ? (
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancelar</button>
        ) : null}
      </div>
    </form>
  );
}
