'use client';

import { useState } from 'react';

export function MisRxIssuedActions({
  prescriptionId,
  canCancel,
}: {
  prescriptionId: string;
  canCancel: boolean;
}) {
  const [loading, setLoading] = useState<'verify' | 'cancel' | null>(null);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'success' | 'error' | 'info'>('info');

  async function verifyPrescription() {
    if (loading) return;
    setLoading('verify');
    setMessage('');

    try {
      const response = await fetch(
        `/api/integrations/misrx/prescriptions/${prescriptionId}/verify`,
        { cache: 'no-store' },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.message || body?.error || 'No se pudo verificar la receta en MisRX.');
      }

      setKind('success');
      setMessage(
        body?.remoteStatus
          ? `Receta verificada en MisRX · Estado: ${body.remoteStatus}`
          : 'Receta verificada en MisRX.',
      );
    } catch (error) {
      setKind('error');
      setMessage(error instanceof Error ? error.message : 'No se pudo verificar la receta en MisRX.');
    } finally {
      setLoading(null);
    }
  }

  async function cancelPrescription() {
    if (loading || !canCancel) return;

    const confirmed = window.confirm(
      '¿Anular esta receta en MisRX? Esta acción afecta la receta ya emitida y no se puede deshacer desde TurnIA.',
    );
    if (!confirmed) return;

    setLoading('cancel');
    setMessage('');

    try {
      const response = await fetch(
        `/api/integrations/misrx/prescriptions/${prescriptionId}/cancel`,
        { method: 'POST' },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error || 'No se pudo anular la receta en MisRX.');
      }

      setKind('success');
      setMessage(body?.message || 'Receta anulada en MisRX.');
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setKind('error');
      setMessage(error instanceof Error ? error.message : 'No se pudo anular la receta en MisRX.');
    } finally {
      setLoading(null);
    }
  }

  const alertClass = kind === 'success'
    ? 'alert success'
    : kind === 'error'
      ? 'alert error'
      : 'alert';

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="form-actions">
        <button
          className="btn secondary"
          type="button"
          onClick={verifyPrescription}
          disabled={Boolean(loading)}
        >
          {loading === 'verify' ? 'Verificando…' : 'Verificar en MisRX'}
        </button>

        {canCancel ? (
          <button
            className="btn danger"
            type="button"
            onClick={cancelPrescription}
            disabled={Boolean(loading)}
          >
            {loading === 'cancel' ? 'Anulando…' : 'Anular receta'}
          </button>
        ) : null}
      </div>

      {message ? <p className={alertClass} style={{ marginBottom: 0 }}>{message}</p> : null}
    </div>
  );
}
