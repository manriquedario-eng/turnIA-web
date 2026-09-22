'use client';

import { useState } from 'react';

type ReadinessCheck = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
};

export function MisRxReadinessPanel({ prescriptionId }: { prescriptionId: string }) {
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveIssuingEnabled, setLiveIssuingEnabled] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueResult, setIssueResult] = useState('');

  async function verify() {
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/integrations/misrx/prescriptions/${prescriptionId}/readiness`,
        { cache: 'no-store' },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'No se pudo verificar la receta');
      setChecks(Array.isArray(body?.checks) ? body.checks : []);
      setReady(Boolean(body?.ready));
      setLiveIssuingEnabled(Boolean(body?.liveIssuingEnabled));
      setIssueResult('');
    } catch (error) {
      setChecks([]);
      setReady(false);
      setLiveIssuingEnabled(false);
      setMessage(error instanceof Error ? error.message : 'No se pudo verificar la receta');
    } finally {
      setLoading(false);
    }
  }

  async function issueHomologation() {
    if (!ready || !liveIssuingEnabled || issuing) return;
    setIssuing(true);
    setIssueResult('');
    setMessage('');

    try {
      const response = await fetch(
        `/api/integrations/misrx/prescriptions/${prescriptionId}/issue`,
        { method: 'POST' },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || body?.message || 'No se pudo emitir la receta de homologación');

      setIssueResult(
        body?.prescriptionNumber
          ? `Receta de homologación emitida. N° ${body.prescriptionNumber}`
          : 'Receta de homologación emitida correctamente.',
      );
      setReady(false);
      setLiveIssuingEnabled(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo emitir la receta de homologación');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <button className="btn secondary" type="button" onClick={verify} disabled={loading}>
          {loading ? 'Verificando…' : 'Verificar preparación'}
        </button>
      </div>

      {message ? <p className="alert error">{message}</p> : null}

      {checks.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          {checks.map((check) => (
            <div key={check.key} className="misrx-check-row">
              <div className="misrx-check-title">
                {check.label}
                <span className={`badge ${check.ok ? 'badge-confirmado' : 'badge-neutral'}`}>
                  {check.ok ? 'Listo' : 'Pendiente'}
                </span>
              </div>
              <div className="misrx-check-detail">{check.detail}</div>
            </div>
          ))}
        </div>
      ) : null}

      {checks.length > 0 ? (
        <p className={ready ? 'alert success' : 'field-hint'}>
          {ready
            ? liveIssuingEnabled
              ? 'El borrador está listo para una emisión controlada de homologación.'
              : 'El borrador tiene los datos técnicos necesarios. El envío sigue bloqueado por configuración.'
            : 'Completá los puntos pendientes antes de intentar una emisión.'}
        </p>
      ) : null}

      {ready && liveIssuingEnabled ? (
        <div className="form-actions">
          <button className="btn" type="button" onClick={issueHomologation} disabled={issuing}>
            {issuing ? 'Emitiendo prueba…' : 'Emitir receta de homologación'}
          </button>
        </div>
      ) : null}

      {issueResult ? <p className="alert success">{issueResult}</p> : null}
    </div>
  );
}
