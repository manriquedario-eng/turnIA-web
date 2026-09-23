'use client';

import { useEffect, useRef, useState } from 'react';
import { autosavePrescriptionDraftMetadata } from '@/app/(protected)/patients/prescription-actions';

export function MisRxDraftInstructions({
  patientId,
  prescriptionId,
  initialObservations,
  initialLongTermTreatment,
  posologyRequired,
}: {
  patientId: string;
  prescriptionId: string;
  initialObservations?: string | null;
  initialLongTermTreatment?: boolean | null;
  posologyRequired?: boolean;
}) {
  const [observations, setObservations] = useState(initialObservations ?? '');
  const [longTermTreatment, setLongTermTreatment] = useState(Boolean(initialLongTermTreatment));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const lastSavedRef = useRef(JSON.stringify({
    observations: initialObservations ?? null,
    longTermTreatment: Boolean(initialLongTermTreatment),
  }));

  useEffect(() => {
    const payload = {
      observations: observations.trim() || null,
      longTermTreatment,
    };
    const serialized = JSON.stringify(payload);

    if (serialized === lastSavedRef.current) return;

    window.dispatchEvent(new CustomEvent('misrx-draft-dirty', {
      detail: { prescriptionId, section: 'instructions' },
    }));

    const timeout = window.setTimeout(async () => {
      setSaveState('saving');
      setErrorMessage('');

      const result = await autosavePrescriptionDraftMetadata({
        patientId,
        prescriptionId,
        ...payload,
      });

      if (!result.ok) {
        setSaveState('error');
        setErrorMessage(result.error);
        window.dispatchEvent(new CustomEvent('misrx-draft-save-error', {
          detail: { prescriptionId, section: 'instructions' },
        }));
        return;
      }

      lastSavedRef.current = serialized;
      setSaveState('saved');
      window.dispatchEvent(new CustomEvent('misrx-draft-saved', {
        detail: { prescriptionId, section: 'instructions' },
      }));
      window.setTimeout(() => setSaveState('idle'), 1800);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [observations, longTermTreatment, patientId, prescriptionId]);

  return (
    <div className="stack">
      <label>
        Posología / Notas
        <textarea
          value={observations}
          onChange={(event) => setObservations(event.target.value)}
          rows={5}
          maxLength={4000}
          placeholder={posologyRequired
            ? 'Indicá cómo debe tomar la medicación. Este convenio requiere posología.'
            : 'Ej.: 1 comprimido cada 12 horas durante 5 días'}
        />
        <span className="field-hint">
          Estas indicaciones forman parte de la receta MisRX.
        </span>
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={longTermTreatment}
          onChange={(event) => setLongTermTreatment(event.target.checked)}
        />
        Tratamiento prolongado
      </label>

      {saveState === 'saving' ? <p className="field-hint">Guardando automáticamente…</p> : null}
      {saveState === 'saved' ? <p className="field-hint is-ready">Indicaciones guardadas.</p> : null}
      {saveState === 'error' ? <p className="alert error">{errorMessage || 'No se pudieron guardar las indicaciones.'}</p> : null}
    </div>
  );
}
