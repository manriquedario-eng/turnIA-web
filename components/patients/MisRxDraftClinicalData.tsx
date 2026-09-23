'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { autosavePrescriptionDraftMetadata } from '@/app/(protected)/patients/prescription-actions';

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
};

type Diagnosis = {
  cie10_id?: number;
  codigo_3c?: string;
  descripcion_3c?: string;
  codigo_4c?: string;
  descripcion_4c?: string;
};

function normalizeCoverageLabel(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resultRows<T>(body: unknown): T[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data as T[] : [];
}

function positiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
  patientName,
  patientDni,
  patientCredential,
  patientInsuranceName,
  patientInsurancePlan,
}: {
  patientId: string;
  prescriptionId: string;
  connected: boolean;
  initialConventionId?: number | null;
  initialAffiliateId?: number | null;
  initialPlanId?: number | null;
  initialDiagnosis?: string | null;
  initialCie10?: string | null;
  patientName: string;
  patientDni?: string | null;
  patientCredential?: string | null;
  patientInsuranceName?: string | null;
  patientInsurancePlan?: string | null;
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
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showDiagnosisTools, setShowDiagnosisTools] = useState(Boolean(initialDiagnosis || initialCie10));
  const lastSavedRef = useRef(JSON.stringify({
    conventionId: initialConventionId ?? null,
    affiliateId: initialAffiliateId ?? null,
    planId: initialPlanId ?? null,
    diagnosis: initialDiagnosis ?? null,
    cie10: initialCie10 ?? null,
  }));

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
        if (cancelled) return;
        const rows = resultRows<Convention>(body);
        setConventions(rows);

        if (!conventionId && patientInsuranceName) {
          const target = normalizeCoverageLabel(patientInsuranceName);
          const matches = rows.filter((item) => {
            const label = normalizeCoverageLabel(item.nombre);
            return label === target || (target.length >= 4 && (label.includes(target) || target.includes(label)));
          });
          if (matches.length === 1) setConventionId(String(matches[0].convenio_id));
        }
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
        } else if (!planId && patientInsurancePlan) {
          const target = normalizeCoverageLabel(patientInsurancePlan);
          const matches = rows.filter((item) => {
            const label = normalizeCoverageLabel(item.descripcion);
            return label === target || (target.length >= 2 && (label.includes(target) || target.includes(label)));
          });
          if (matches.length === 1) setPlanId(String(matches[0].plan_id));
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

  const autosavePayload = useMemo(() => ({
    conventionId: positiveNumber(conventionId),
    affiliateId: positiveNumber(affiliateId),
    planId: positiveNumber(planId),
    diagnosis: diagnosis.trim() || null,
    cie10: cie10.trim() || null,
  }), [conventionId, affiliateId, planId, diagnosis, cie10]);

  useEffect(() => {
    const serialized = JSON.stringify(autosavePayload);
    if (serialized === lastSavedRef.current) return;

    window.dispatchEvent(new CustomEvent('misrx-draft-dirty', {
      detail: { prescriptionId, section: 'clinical' },
    }));

    const timeout = window.setTimeout(async () => {
      setSaveState('saving');
      const result = await autosavePrescriptionDraftMetadata({
        patientId,
        prescriptionId,
        ...autosavePayload,
      });

      if (!result.ok) {
        setSaveState('error');
        setMessage(result.error);
        window.dispatchEvent(new CustomEvent('misrx-draft-save-error', {
          detail: { prescriptionId, section: 'clinical' },
        }));
        return;
      }

      lastSavedRef.current = serialized;
      setSaveState('saved');
      window.dispatchEvent(new CustomEvent('misrx-draft-saved', {
        detail: { prescriptionId, section: 'clinical' },
      }));
      window.dispatchEvent(new CustomEvent('misrx-draft-context', {
        detail: {
          prescriptionId,
          conventionId: autosavePayload.conventionId,
          affiliateId: autosavePayload.affiliateId,
          planId: autosavePayload.planId,
        },
      }));
      window.setTimeout(() => setSaveState('idle'), 1800);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [autosavePayload, patientId, prescriptionId]);

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

  async function searchDiagnosis(queryOverride?: string) {
    const term = (queryOverride ?? diagnosisQuery).trim();
    setMessage('');
    setDiagnoses([]);

    if (term.length < 2) {
      setMessage('Escribí al menos 2 caracteres para buscar CIE-10.');
      return;
    }

    setDiagnosisLoading(true);

    try {
      const params = new URLSearchParams({ q: term });
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

  useEffect(() => {
    if (!connected || !showDiagnosisTools) return;
    const term = diagnosisQuery.trim();
    if (term.length < 3) {
      setDiagnoses([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchDiagnosis(term);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [connected, showDiagnosisTools, diagnosisQuery]);

  return (
    <div className="stack">
      {connected ? (
        <>
          <div className="alert" style={{ marginBottom: 0 }}>
            <strong>Paciente de esta receta:</strong> {patientName}.{' '}
            TurnIA valida su afiliación en MisRX usando DNI/documento {patientDni || 'sin cargar'} y Nº afiliado/credencial {patientCredential || 'sin cargar'}.
            {!patientDni || !patientCredential ? ' Completalos en Paciente → Datos antes de consultar.' : ''}
          </div>

          {(patientInsuranceName || patientInsurancePlan) ? (
            <div className="misrx-search-context">
              <span className="field-hint">Cobertura cargada en el paciente</span>
              <strong>{[patientInsuranceName, patientInsurancePlan].filter(Boolean).join(' · ')}</strong>
              <span className="field-hint">TurnIA intenta vincularla automáticamente con el convenio y plan devueltos por MisRX.</span>
            </div>
          ) : null}

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
                <div className="form-grid">
                  <label>
                    Buscar diagnóstico CIE-10
                    <input
                      value={diagnosisQuery}
                      onChange={(event) => setDiagnosisQuery(event.target.value)}
                      minLength={2}
                      maxLength={100}
                      placeholder="Ej.: hipertensión, diabetes, F32"
                      autoComplete="off"
                    />
                  </label>
                  <div className="misrx-inline-action" style={{ alignSelf: 'end' }}>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => void searchDiagnosis()}
                      disabled={diagnosisLoading}
                    >
                      {diagnosisLoading ? 'Buscando…' : 'Buscar CIE-10'}
                    </button>
                  </div>
                </div>

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

                <div className="form-grid">
                  <label>
                    Diagnóstico
                    <input value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} maxLength={500} />
                  </label>
                  <label>
                    CIE-10
                    <input value={cie10} onChange={(event) => setCie10(event.target.value)} maxLength={20} />
                  </label>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <p className="field-hint">
          Conectá MisRX para validar convenio, afiliado y diagnóstico.
        </p>
      )}

      {message ? <p className="field-hint">{message}</p> : null}
      {saveState === 'saving' ? <p className="field-hint">Guardando automáticamente…</p> : null}
      {saveState === 'saved' ? <p className="field-hint is-ready">Datos guardados.</p> : null}
      {saveState === 'error' ? <p className="alert error">No se pudo guardar automáticamente.</p> : null}
    </div>
  );
}
