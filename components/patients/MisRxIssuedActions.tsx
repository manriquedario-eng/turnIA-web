'use client';

import { useState } from 'react';

export function MisRxIssuedActions({
  prescriptionId,
}: {
  prescriptionId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'success' | 'error' | 'info'>('info');

  async function verifyPrescription() {
    if (loading) return;
    setLoading(true);
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
      setLoading(false);
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
          disabled={loading}
        >
          {loading ? 'Verificando…' : 'Verificar en MisRX'}
        </button>
      </div>

      {message ? <p className={alertClass} style={{ marginBottom: 0 }}>{message}</p> : null}
    </div>
  );
}
