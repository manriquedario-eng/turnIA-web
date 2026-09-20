'use client';

import { useState } from 'react';

type LastAuthorized = {
  environment: 'homologacion' | 'produccion';
  pointOfSale: number;
  voucherType: number;
  lastAuthorizedNumber: number | null;
  events: string[];
  checkedAt: string;
};

export function ArcaLastAuthorizedTest() {
  const [pointOfSale, setPointOfSale] = useState('3');
  const [voucherType, setVoucherType] = useState('11');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LastAuthorized | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/arca/wsfe/last-authorized', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          pointOfSale: Number(pointOfSale),
          voucherType: Number(voucherType),
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? 'No se pudo consultar el último comprobante.');
        return;
      }

      setResult(payload.data as LastAuthorized);
    } catch {
      setError('No se pudo completar la consulta a ARCA.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="integration-row-name">
        Prueba segura: último comprobante autorizado
        <span className="badge badge-neutral">Homologación</span>
      </div>

      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Consulta FECompUltimoAutorizado. No genera, reserva ni autoriza ningún comprobante.
      </p>

      <div className="form-grid" style={{ marginTop: 14 }}>
        <label>
          Punto de venta de prueba
          <input
            type="number"
            min="1"
            max="99999"
            value={pointOfSale}
            onChange={(event) => setPointOfSale(event.target.value)}
          />
        </label>

        <label>
          Tipo de comprobante
          <input
            type="number"
            min="1"
            max="999"
            value={voucherType}
            onChange={(event) => setVoucherType(event.target.value)}
          />
          <span className="field-hint">11 = Factura C</span>
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          className="btn secondary"
          type="button"
          onClick={runTest}
          disabled={loading || !pointOfSale || !voucherType}
        >
          {loading ? 'Consultando ARCA…' : 'Consultar último autorizado'}
        </button>
      </div>

      {error ? (
        <div className="alert error" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="alert" style={{ marginTop: 12 }}>
          <div>
            ARCA respondió para punto de venta <strong>{result.pointOfSale}</strong> y tipo <strong>{result.voucherType}</strong>.
          </div>
          <div style={{ marginTop: 4 }}>
            Último comprobante autorizado:{' '}
            <strong>{result.lastAuthorizedNumber == null ? 'sin número informado' : result.lastAuthorizedNumber}</strong>
          </div>
          {result.events.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              Eventos: {result.events.join(' | ')}
            </div>
          ) : null}
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Consulta realizada el {new Date(result.checkedAt).toLocaleString('es-AR')}.
          </div>
        </div>
      ) : null}
    </div>
  );
}
