'use client';

import { useState } from 'react';

type TestInvoiceResult = {
  environment: 'homologacion' | 'produccion';
  pointOfSale: number;
  voucherType: number;
  voucherNumber: number;
  amount: number;
  result: string;
  cae: string | null;
  caeExpiresAt: string | null;
  observations: string[];
  events: string[];
  processedAt: string | null;
  requestedAt: string;
};

export function ArcaTestInvoiceC() {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestInvoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    if (!confirmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/arca/wsfe/test-invoice-c', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });

      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? 'ARCA no pudo procesar la factura C de prueba.');
        return;
      }

      setResult(payload.data as TestInvoiceResult);
      setConfirmed(false);
    } catch {
      setError('No se pudo completar la emisión de prueba contra ARCA.');
    } finally {
      setLoading(false);
    }
  }

  const approved = result?.result === 'A' && Boolean(result?.cae);
  const voucherLabel = result ? '00003-' + String(result.voucherNumber).padStart(8, '0') : '';

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="integration-row-name">
        Primera Factura C de prueba
        <span className="badge badge-neutral">Homologación</span>
      </div>

      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Esta acción sí solicita un CAE, pero únicamente en el ambiente de homologación de ARCA.
        No genera una factura fiscal de producción.
      </p>

      <div className="alert" style={{ marginTop: 12 }}>
        <strong>Datos fijos de esta prueba:</strong> punto de venta 3 · Factura C · Servicios · Consumidor Final · $1.000 ARS.
        TurnIA consulta primero el último número autorizado y solicita el siguiente correlativo.
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14 }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={loading}
          style={{ marginTop: 3 }}
        />
        <span>
          Entiendo que se generará un comprobante <strong>de prueba en homologación</strong> y se solicitará un CAE de testing.
        </span>
      </label>

      <div style={{ marginTop: 12 }}>
        <button className="btn" type="button" onClick={issue} disabled={!confirmed || loading}>
          {loading ? 'Solicitando CAE de prueba…' : 'Emitir Factura C de prueba'}
        </button>
      </div>

      {error ? <div className="alert error" style={{ marginTop: 12 }}>{error}</div> : null}

      {result ? (
        <div className={approved ? 'alert success' : 'alert'} style={{ marginTop: 12 }}>
          <div>
            Resultado ARCA: <strong>{result.result || 'sin código'}</strong>
            {approved ? ' · APROBADO' : ''}
          </div>
          <div style={{ marginTop: 4 }}>
            Comprobante: <strong>{voucherLabel}</strong> · Total <strong>{'$' + result.amount.toLocaleString('es-AR') + ' ARS'}</strong>
          </div>
          <div style={{ marginTop: 4 }}>
            CAE: <strong>{result.cae ?? 'no otorgado'}</strong>
            {result.caeExpiresAt ? <> · Vencimiento: <strong>{result.caeExpiresAt}</strong></> : null}
          </div>
          {result.observations.length > 0 ? (
            <div style={{ marginTop: 6 }}>Observaciones: {result.observations.join(' | ')}</div>
          ) : null}
          {result.events.length > 0 ? (
            <div style={{ marginTop: 6 }}>Eventos: {result.events.join(' | ')}</div>
          ) : null}
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Solicitud realizada el {new Date(result.requestedAt).toLocaleString('es-AR')}.
          </div>
        </div>
      ) : null}
    </div>
  );
}
