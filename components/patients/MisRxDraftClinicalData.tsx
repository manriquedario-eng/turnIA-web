'use client';

import { FormEvent, useEffect, useState } from 'react';
import { updatePrescriptionDraftMetadata } from '@/app/(protected)/patients/prescription-actions';

type Convention = {
  convenio_id: number;
  nombre: string;
};

type Affiliate = {
  afiliado_id: number;
  nroafiliado?: string;
  apenomb_afiliado?: string;
  nrodoc?: number;
};

type Diagnosis = {
  cie10_id?: number;
  codigo_3c?: string;
  descripcion_3c?: string;
  codigo_4c?: string;
  descripcion_4c?: string;
};

function resultRows<T>(body: unknown): T[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data as T[] : [];
}

export function MisRxDraftClinicalData({
  patientId,
  prescriptionId,
  connected,
  initialConventionId,
  initialAffiliateId,
  initialDiagnosis,
  initialCie10,
  initialObservations,
  initialLongTermTreatment,
}: {
  patientId: string;
  prescriptionId: string;
  connected: boolean;
  initialConventionId?: number | null;
  initialAffiliateId?: number | null;
  initialDiagnosis?: string | null;
  initialCie10?: string | null;
  initialObservations?: string | null;
  initialLongTermTreatment?: boolean | null;
}) {
  const [conventions, setConventions] = useState<Convention[]>([]);
  const [conventionId, setConventionId] = useState(initialConventionId ? String(initialConventionId) : '');
  const [affiliateId, setAffiliateId] = useState(initialAffiliateId ? String(initialAffiliateId) : '');
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [diagnosis, setDiagnosis] = useState(initialDiagnosis ?? '');
  const [cie10, setCie10] = useState(initialCie10 ?? '');
  const [diagnosisQuery, setDiagnosisQuery] = useState('');
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    fetch('/api/integrations/misrx/conventions', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || 'No se pudieron cargar los convenios');
        return body;
      })
      .then((body) => {
        if (!cancelled) setConventions(resultRows<Convention>(body));
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'No se pudieron cargar los convenios');
      });

    return () => {
      cancelled = true;
    };
  }, [connected]);

  async function lookupAffiliate() {
    setMessage('');
    setAffiliates([]);
    if (!conventionId) {
      setMessage('Seleccioná primero un convenio.');
      return;
    }

    try {
      const params = new URLSearchParams({
        patient_id: patientId,
        convenio_id: conventionId,
      });
      const response = await fetch(`/api/integrations/misrx/affiliate?${params.toString()}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'No se pudo consultar el afiliado');
      const rows = resultRows<Affiliate>(body);
      setAffiliates(rows);
      if (rows.length === 1) setAffiliateId(String(rows[0].afiliado_id));
      if (rows.length === 0) setMessage('MisRX no encontró afiliados con los datos actuales del paciente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo consultar el afiliado');
    }
  }

  async function searchDiagnosis(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setDiagnoses([]);

    if (diagnosisQuery.trim().length < 2) {
      setMessage('Escribí al menos 2 caracteres para buscar CIE-10.');
      return;
    }

    try {
      const params = new URLSearchParams({ q: diagnosisQuery.trim() });
      const response = await fetch(`/api/integrations/misrx/diagnoses?${params.toString()}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'No se pudo buscar CIE-10');
      const rows = resultRows<Diagnosis>(body);
      setDiagnoses(rows);
      if (rows.length === 0) setMessage('No se encontraron diagnósticos para esa búsqueda.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar CIE-10');
    }
  }

  return (
    <div className="stack">
      {connected ? (
        <>
          <div className="form-grid">
            <label>
              Convenio
              <select
                value={conventionId}
                onChange={(event) => {
                  setConventionId(event.target.value);
                  setAffiliateId('');
                  setAffiliates([]);
                }}
              >
                <option value="">Seleccionar convenio</option>
                {conventions.map((item) => (
                  <option key={item.convenio_id} value={item.convenio_id}>{item.nombre}</option>
                ))}
              </select>
            </label>
            <div>
              <span className="field-label">Afiliado</span>
              <div className="form-actions">
                <button className="btn secondary" type="button" onClick={lookupAffiliate} disabled={!conventionId}>
                  Buscar afiliado
                </button>
              </div>
            </div>
          </div>

          {affiliates.length > 0 ? (
            <label>
              Coincidencia en MisRX
              <select value={affiliateId} onChange={(event) => setAffiliateId(event.target.value)}>
                <option value="">Sin seleccionar</option>
                {affiliates.map((item) => (
                  <option key={item.afiliado_id} value={item.afiliado_id}>
                    {item.apenomb_afiliado || 'Afiliado'}{item.nroafiliado ? ` · ${item.nroafiliado}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <form onSubmit={searchDiagnosis} className="form-grid">
            <label>
              Buscar diagnóstico CIE-10
              <input
                value={diagnosisQuery}
                onChange={(event) => setDiagnosisQuery(event.target.value)}
                minLength={2}
                maxLength={100}
                placeholder="Código o descripción"
              />
            </label>
            <div className="form-actions" style={{ alignSelf: 'end' }}>
              <button className="btn secondary" type="submit">Buscar CIE-10</button>
            </div>
          </form>

          {diagnoses.length > 0 ? (
            <div className="stack" style={{ gap: 8 }}>
              {diagnoses.slice(0, 20).map((item, index) => {
                const code = item.codigo_4c || item.codigo_3c || '';
                const label = item.descripcion_4c || item.descripcion_3c || code || 'Diagnóstico';
                return (
                  <button
                    key={String(item.cie10_id ?? code ?? index)}
                    type="button"
                    className="integration-row"
                    style={{ textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => {
                      setCie10(code);
                      setDiagnosis(label);
                      setDiagnoses([]);
                    }}
                  >
                    <strong>{code ? `${code} · ` : ''}{label}</strong>
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : (
        <p className="field-hint">
          Podés guardar los datos clínicos manualmente. Las búsquedas de convenio, afiliado y CIE-10 se habilitan al conectar MisRX.
        </p>
      )}

      {message ? <p className="field-hint">{message}</p> : null}

      <form action={updatePrescriptionDraftMetadata} className="form-grid">
        <input type="hidden" name="patientId" value={patientId} />
        <input type="hidden" name="prescriptionId" value={prescriptionId} />
        <input type="hidden" name="conventionId" value={conventionId} />
        <input type="hidden" name="affiliateId" value={affiliateId} />
        <label>
          Diagnóstico
          <input
            name="diagnosis"
            value={diagnosis}
            onChange={(event) => setDiagnosis(event.target.value)}
            maxLength={500}
          />
        </label>
        <label>
          CIE-10
          <input
            name="cie10"
            value={cie10}
            onChange={(event) => setCie10(event.target.value)}
            maxLength={20}
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          Observaciones / indicaciones
          <textarea name="observations" rows={4} maxLength={4000} defaultValue={initialObservations ?? ''} />
        </label>
        <label className="checkbox-field" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" name="longTermTreatment" defaultChecked={Boolean(initialLongTermTreatment)} />
          Tratamiento prolongado
        </label>
        <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
          <button className="btn" type="submit">Guardar datos de receta</button>
        </div>
      </form>
    </div>
  );
}
