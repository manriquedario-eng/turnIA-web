'use client';

import { useEffect, useState } from 'react';
import { updatePrescriptionDraftMetadata } from '@/app/(protected)/patients/prescription-actions';

type Convention = {
  convenio_id: number;
  nombre: string;
  digital_elige_plan?: boolean;
  permite_sustitucion?: boolean;
  diagnostico_requerido?: number;
  posologia_requierida?: number;
  digital_tratamiento_prolongado?: number;
};

type Affiliate = {
  afiliado_id: number;
  nroafiliado?: string;
  apenomb_afiliado?: string;
  nrodoc?: number;
};

type Plan = {
  convenio_id?: number;
  plan_id: number;
  descripcion?: string;
  porc_cobertura?: number;
  convenio_plan_cod?: number;
  regla_items_por_receta?: number;
  regla_unidades_por_receta?: number;
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
  initialPlanId,
  initialDiagnosis,
  initialCie10,
  initialObservations,
  initialLongTermTreatment,
  patientName,
  patientDni,
  patientCredential,
}: {
  patientId: string;
  prescriptionId: string;
  connected: boolean;
  initialConventionId?: number | null;
  initialAffiliateId?: number | null;
  initialPlanId?: number | null;
  initialDiagnosis?: string | null;
  initialCie10?: string | null;
  initialObservations?: string | null;
  initialLongTermTreatment?: boolean | null;
  patientName: string;
  patientDni?: string | null;
  patientCredential?: string | null;
}) {
  const [conventions, setConventions] = useState<Convention[]>([]);
  const [conventionId, setConventionId] = useState(initialConventionId ? String(initialConventionId) : '');
  const [affiliateId, setAffiliateId] = useState(initialAffiliateId ? String(initialAffiliateId) : '');
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [planId, setPlanId] = useState(initialPlanId ? String(initialPlanId) : '');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState(initialDiagnosis ?? '');
  const [cie10, setCie10] = useState(initialCie10 ?? '');
  const [diagnosisQuery, setDiagnosisQuery] = useState('');
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [message, setMessage] = useState('');
  const [affiliateLoading, setAffiliateLoading] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [showDiagnosisTools, setShowDiagnosisTools] = useState(Boolean(initialDiagnosis || initialCie10));
  const selectedConvention = conventions.find((item) => String(item.convenio_id) === conventionId);
  const diagnosisRequired = Boolean(selectedConvention?.diagnostico_requerido);

  useEffect(() => {
    if (diagnosisRequired) setShowDiagnosisTools(true);
  }, [diagnosisRequired]);

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

  useEffect(() => {
    if (!connected || !conventionId) {
      setPlans([]);
      return;
    }

    let cancelled = false;
    setPlansLoading(true);

    const params = new URLSearchParams({ convenio_id: conventionId });
    if (affiliateId) params.set('afiliado_id', affiliateId);

    fetch(`/api/integrations/misrx/plans?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || 'No se pudieron cargar los planes');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const rows = resultRows<Plan>(body);
        setPlans(rows);
        if (planId && !rows.some((item) => String(item.plan_id) === planId)) {
          setPlanId('');
        }
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, conventionId, affiliateId]);

  async function lookupAffiliate() {
    setMessage('');
    setAffiliates([]);
    if (!conventionId) {
      setMessage('Seleccioná primero un convenio.');
      return;
    }

    setAffiliateLoading(true);
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
    } finally {
      setAffiliateLoading(false);
    }
  }

  async function searchDiagnosis() {
    setMessage('');
    setDiagnoses([]);

    if (diagnosisQuery.trim().length < 2) {
      setMessage('Escribí al menos 2 caracteres para buscar CIE-10.');
      return;
    }

    setDiagnosisLoading(true);
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
    } finally {
      setDiagnosisLoading(false);
    }
  }

  return (
    <div className="stack">
      {connected ? (
        <>
          <div className="alert" style={{ marginBottom: 0 }}>
            <strong>Paciente de esta receta:</strong> {patientName}.{' '}
            TurnIA valida su afiliación en MisRX usando DNI/documento {patientDni || 'sin cargar'} y Nº afiliado/credencial {patientCredential || 'sin cargar'}.
            {!patientDni || !patientCredential ? ' Completalos en Paciente → Datos antes de consultar.' : ''}
          </div>
          <div className="form-grid">
            <label>
              Convenio
              <select
                value={conventionId}
                onChange={(event) => {
                  setConventionId(event.target.value);
                  setAffiliateId('');
                  setAffiliates([]);
                  setPlanId('');
                  setPlans([]);
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
              <div className="misrx-inline-action">
                <button className="btn secondary" type="button" onClick={lookupAffiliate} disabled={!conventionId || affiliateLoading}>
                  {affiliateLoading ? 'Buscando…' : 'Buscar afiliado'}
                </button>
                {!conventionId ? <span className="field-hint">Elegí primero el convenio.</span> : null}
              </div>
            </div>
          </div>

          {selectedConvention ? (
            <div className="misrx-rule-strip" aria-label="Reglas del convenio seleccionado">
              {selectedConvention.diagnostico_requerido ? <span className="badge badge-pendiente">Diagnóstico requerido</span> : null}
              {selectedConvention.digital_elige_plan ? <span className="badge badge-pendiente">Plan requerido</span> : null}
              {selectedConvention.posologia_requierida ? <span className="badge badge-pendiente">Posología requerida</span> : null}
              {selectedConvention.permite_sustitucion === false ? <span className="badge badge-neutral">Sin sustitución</span> : null}
            </div>
          ) : null}

          {affiliates.length > 0 ? (
            <div className="misrx-affiliate-match">
              <div>
                <span className="field-label">Afiliado validado</span>
                <strong>{patientName}</strong>
                <p className="field-hint" style={{ margin: '4px 0 0' }}>
                  MisRX encontró {affiliates.length === 1 ? 'una coincidencia' : `${affiliates.length} coincidencias`} para los identificadores cargados en TurnIA.
                </p>
              </div>
              <label>
                Registro técnico MisRX
                <select value={affiliateId} onChange={(event) => {
                  setAffiliateId(event.target.value);
                  setPlanId('');
                }}>
                  <option value="">Sin seleccionar</option>
                  {affiliates.map((item) => (
                    <option key={item.afiliado_id} value={item.afiliado_id}>
                      {item.nroafiliado ? `Afiliado ${item.nroafiliado}` : `ID ${item.afiliado_id}`}
                      {item.nrodoc ? ` · DNI ${item.nrodoc}` : ''}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  El nombre del padrón de homologación puede ser genérico. La receta sigue asociada a {patientName} dentro de TurnIA.
                </span>
              </label>
            </div>
          ) : null}

          {plans.length > 0 || plansLoading ? (
            <label>
              Plan
              <select value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={plansLoading}>
                <option value="">{plansLoading ? 'Cargando planes…' : 'Seleccionar plan (si corresponde)'}</option>
                {plans.map((plan) => (
                  <option key={plan.plan_id} value={plan.plan_id}>
                    {plan.descripcion || `Plan ${plan.plan_id}`}
                    {plan.porc_cobertura != null ? ` · Cobertura ${plan.porc_cobertura}%` : ''}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                MisRX puede exigir un plan según el convenio. Si aparecen opciones, elegí la que corresponda al afiliado.
              </span>
            </label>
          ) : null}

          <div className="misrx-diagnosis-section">
            <div className="misrx-inline-action" style={{ justifyContent: 'space-between' }}>
              <div>
                <span className="field-label">Diagnóstico / CIE-10</span>
                <p className="field-hint" style={{ margin: '4px 0 0' }}>
                  {diagnosisRequired ? 'Este convenio exige diagnóstico.' : 'Usalo cuando corresponda al profesional o al convenio.'}
                </p>
              </div>
              {!diagnosisRequired ? (
                <button
                  className="btn secondary btn-compact"
                  type="button"
                  onClick={() => setShowDiagnosisTools((value) => !value)}
                >
                  {showDiagnosisTools ? 'Ocultar' : 'Agregar diagnóstico'}
                </button>
              ) : null}
            </div>

            {showDiagnosisTools ? (
              <>
                {connected ? (
                  <div className="form-grid">
                    <label>
                      Buscar diagnóstico CIE-10
                      <input
                        value={diagnosisQuery}
                        onChange={(event) => setDiagnosisQuery(event.target.value)}
                        minLength={2}
                        maxLength={100}
                        placeholder="Ej.: hipertensión, diabetes, F32"
                      />
                    </label>
                    <div className="misrx-inline-action" style={{ alignSelf: 'end' }}>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={searchDiagnosis}
                        disabled={diagnosisLoading}
                      >
                        {diagnosisLoading ? 'Buscando…' : 'Buscar CIE-10'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {diagnoses.length > 0 ? (
                  <div className="stack" style={{ gap: 8 }}>
                    {diagnoses.slice(0, 20).map((item, index) => {
                      const code = item.codigo_4c || item.codigo_3c || '';
                      const label = item.descripcion_4c || item.descripcion_3c || code || 'Diagnóstico';
                      return (
                        <button
                          key={String(item.cie10_id ?? code ?? index)}
                          type="button"
                          className="misrx-choice-button"
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
            ) : null}
          </div>
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
        <input type="hidden" name="planId" value={planId} />
        {showDiagnosisTools ? (
          <>
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
          </>
        ) : (
          <>
            <input type="hidden" name="diagnosis" value={diagnosis} />
            <input type="hidden" name="cie10" value={cie10} />
          </>
        )}
        <label style={{ gridColumn: '1 / -1' }}>
          Observaciones / indicaciones / posología
          <textarea
            name="observations"
            rows={4}
            maxLength={4000}
            defaultValue={initialObservations ?? ''}
            placeholder={selectedConvention?.posologia_requierida ? 'Completá la posología requerida por el convenio' : 'Opcional'}
          />
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
