'use client';

import { useEffect, useState } from 'react';

type ReadinessCheck = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
};

function actionForCheck(key: string, patientId: string) {
  if ([
    'convention',
    'convention-enabled',
    'provider-required',
    'patient',
    'diagnosis-required',
    'cie10-only',
    'diagnosis-per-product',
    'plan-required',
    'plan-valid',
  ].includes(key)) {
    return {
      label: key === 'patient'
        ? 'Corregir afiliado'
        : key === 'provider-required' || key === 'convention-enabled'
          ? 'Revisar convenio'
          : 'Corregir datos',
      href: '#clinical',
    };
  }

  if (key === 'posology-required') {
    return { label: 'Completar posología', href: '#posology' };
  }

  if (['items', 'item-limit', 'plan-item-limit', 'plan-unit-limit', 'substitution-rule'].includes(key)) {
    return { label: 'Ir a medicamentos', href: '#medications' };
  }

  if (key === 'homologation-patient') {
    return { label: 'Editar paciente', href: `/patients/${patientId}#datos` };
  }

  if (['connection', 'prescriber', 'homologation-doctor'].includes(key)) {
    return { label: 'Revisar MisRX', href: '/settings#integraciones' };
  }

  return null;
}

function goTo(href: string) {
  if (href.startsWith('#')) {
    const element = document.querySelector(href);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  window.location.href = href;
}

export function MisRxReadinessPanel({
  prescriptionId,
  patientId,
}: {
  prescriptionId: string;
  patientId: string;
}) {
  const [errors, setErrors] = useState<ReadinessCheck[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [issueResult, setIssueResult] = useState('');
  const [pendingSections, setPendingSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    function detailFor(event: Event) {
      return (event as CustomEvent<{ prescriptionId?: string; section?: string }>).detail;
    }

    function markDirty(event: Event) {
      const detail = detailFor(event);
      if (!detail || detail.prescriptionId !== prescriptionId || !detail.section) return;
      setPendingSections((current) => {
        const next = new Set(current);
        next.add(detail.section as string);
        return next;
      });
    }

    function markSaved(event: Event) {
      const detail = detailFor(event);
      if (!detail || detail.prescriptionId !== prescriptionId || !detail.section) return;
      setPendingSections((current) => {
        const next = new Set(current);
        next.delete(detail.section as string);
        return next;
      });
    }

    window.addEventListener('misrx-draft-dirty', markDirty);
    window.addEventListener('misrx-draft-saved', markSaved);

    return () => {
      window.removeEventListener('misrx-draft-dirty', markDirty);
      window.removeEventListener('misrx-draft-saved', markSaved);
    };
  }, [prescriptionId]);

  async function sendPrescription() {
    if (loading) return;
    if (pendingSections.size > 0) {
      setMessage('TurnIA todavía está guardando los últimos cambios. Esperá un instante y volvé a enviar.');
      return;
    }

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
        setMessage('La receta está completa. La emisión de homologación sigue bloqueada hasta habilitar explícitamente la prueba controlada.');
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
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la receta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack misrx-send-panel">
      <div className="form-actions">
        <button className="btn" type="button" onClick={sendPrescription} disabled={loading || pendingSections.size > 0}>
          {loading
            ? 'Verificando…'
            : pendingSections.size > 0
              ? 'Guardando cambios…'
              : 'Enviar receta'}
        </button>
      </div>

      {message ? <p className={errors.length > 0 ? 'alert error' : 'alert'}>{message}</p> : null}

      {errors.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          {errors.map((check) => {
            const action = actionForCheck(check.key, patientId);
            return (
              <div key={check.key} className="alert error" style={{ margin: 0 }}>
                <div className="misrx-inline-action" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{check.label}:</strong> {check.detail}
                  </div>
                  {action ? (
                    <button className="btn secondary btn-compact" type="button" onClick={() => goTo(action.href)}>
                      {action.label}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {issueResult ? <p className="alert success">{issueResult}</p> : null}
    </div>
  );
}
