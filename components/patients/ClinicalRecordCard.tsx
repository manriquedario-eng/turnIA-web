'use client';

import { useState } from 'react';

export type ClinicalRecordData = {
  reason: string | null;
  background: string | null;
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

    const fields: Array<[string, string | null]> = [
      ['Motivo de consulta', record.reason],
      ['Antecedentes', record.background],
      ['Plan / indicaciones', record.plan],
      ['Notas generales', record.notes],
    ];

    return (
      <div className="stack" style={{ gap: 14 }}>
        {fields.map(([label, value]) => (
          <div key={label}>
            <h3 style={{ margin: '0 0 4px' }}>{label}</h3>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{value || <span className="muted">Sin datos</span>}</p>
          </div>
        ))}
        <div>
          <button type="button" className="btn secondary" onClick={() => setEditing(true)}>Editar ficha clínica</button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      <input type="hidden" name="patientId" value={patientId} />
      <label>
        Motivo de consulta
        <textarea name="reason" defaultValue={record?.reason ?? ''} rows={2} maxLength={10000} style={{ width: '100%' }} />
      </label>
      <label>
        Antecedentes
        <textarea name="background" defaultValue={record?.background ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
      </label>
      <label>
        Plan / indicaciones
        <textarea name="plan" defaultValue={record?.plan ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
      </label>
      <label>
        Notas generales
        <textarea name="notes" defaultValue={record?.notes ?? ''} rows={3} maxLength={10000} style={{ width: '100%' }} />
      </label>
      <div className="nav">
        <button className="btn" type="submit">{record ? 'Guardar cambios' : 'Completar ficha clínica'}</button>
        {record ? (
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancelar</button>
        ) : null}
      </div>
    </form>
  );
}
