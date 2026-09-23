'use client';

import { useState } from 'react';

type ReadinessCheck = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
};

export function MisRxReadinessPanel({ prescriptionId }: { prescriptionId: string }) {
  const [errors, setErrors] = useState<ReadinessCheck[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [issueResult, setIssueResult] = useState('');

  async function sendPrescription() {
    if (loading) return;

    setLoading(true);
    setErrors([]);
    setMessage('');
    setIssueResult('');

    try {
      const readinessResponse = await fetch(
        `/api/integrations/misrx/prescriptions/${prescriptionId}/readiness`,
        { cache: 'no-store' },
      );
      const readinessBody = await readinessResponse.json();

      if (!readinessResponse.ok) {
        throw new Error(readinessBody?.error || 'No se pudo verificar la receta');
      }

      const checks = Array.isArray(readinessBody?.checks)
        ? readinessBody.checks as ReadinessCheck[]
        : [];
      const failed = checks.filter((check) => !check.ok);

      if (!readinessBody?.ready || failed.length > 0) {
        setErrors(failed);
        setMessage('Hay datos que corregir antes de enviar la receta.');
        return;
      }

      if (!readinessBody?.liveIssuingEnabled) {
        setMessage('La receta está completa, pero el envío de homologación continúa bloqueado por configuración.');
        return;
      }

      const issueResponse = await fetch(
        `/api/integrations/misrx/prescriptions/${prescriptionId}/issue`,
        { method: 'POST' },
      );
      const issueBody = await issueResponse.json();

      if (!issueResponse.ok) {
        throw new Error(issueBody?.error || issueBody?.message || 'No se pudo enviar la receta');
      }

      setIssueResult(
        issueBody?.prescriptionNumber
          ? `Receta enviada correctamente. N° ${issueBody.prescriptionNumber}`
          : 'Receta enviada correctamente.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la receta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack misrx-send-panel">
      <div className="form-actions">
        <button className="btn" type="button" onClick={sendPrescription} disabled={loading}>
          {loading ? 'Verificando…' : 'Enviar receta'}
        </button>
      </div>

      {message ? <p className={errors.length > 0 ? 'alert error' : 'alert'}>{message}</p> : null}

      {errors.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          {errors.map((check) => (
            <div key={check.key} className="alert error" style={{ margin: 0 }}>
              <strong>{check.label}:</strong> {check.detail}
            </div>
          ))}
        </div>
      ) : null}

      {issueResult ? <p className="alert success">{issueResult}</p> : null}
    </div>
  );
}
