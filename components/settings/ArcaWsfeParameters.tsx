'use client';

import { useState } from 'react';

type ParameterItem = {
  id: number | string;
  description: string;
  from?: string | null;
  to?: string | null;
  extra?: Record<string, string | number | boolean | null>;
};

type PointOfSale = {
  number: number;
  emissionType: string | null;
  blocked: boolean | null;
  from: string | null;
  to: string | null;
};

type Snapshot = {
  environment: 'homologacion' | 'produccion';
  pointsOfSale: PointOfSale[];
  voucherTypes: ParameterItem[];
  documentTypes: ParameterItem[];
  conceptTypes: ParameterItem[];
  vatRates: ParameterItem[];
  receiverVatConditions: ParameterItem[];
  fetchedAt: string;
};

function Table({
  title,
  rows,
  extraLabel,
}: {
  title: string;
  rows: ParameterItem[];
  extraLabel?: string;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">ARCA no devolvió registros.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '7px 8px' }}>Código</th>
                <th style={{ textAlign: 'left', padding: '7px 8px' }}>Descripción</th>
                {extraLabel ? <th style={{ textAlign: 'left', padding: '7px 8px' }}>{extraLabel}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id) + '-' + index}>
                  <td style={{ padding: '7px 8px', borderTop: '1px solid var(--border, #e5e7eb)' }}>{row.id}</td>
                  <td style={{ padding: '7px 8px', borderTop: '1px solid var(--border, #e5e7eb)' }}>{row.description}</td>
                  {extraLabel ? (
                    <td style={{ padding: '7px 8px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
                      {String(row.extra?.voucherClass ?? '')}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ArcaWsfeParameters() {
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/arca/wsfe/parameters', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setSnapshot(null);
        setError(payload?.error ?? 'No se pudieron consultar los parámetros de ARCA.');
        return;
      }

      setSnapshot(payload.data as Snapshot);
    } catch {
      setSnapshot(null);
      setError('No se pudo completar la consulta a ARCA.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="integration-row-name">
        Parámetros de facturación WSFEv1
        <span className="badge badge-neutral">Homologación</span>
      </div>
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Consulta en vivo los parámetros fiscales habilitados por ARCA. Esta etapa todavía no emite comprobantes.
      </p>

      <div style={{ marginTop: 12 }}>
        <button className="btn secondary" type="button" onClick={load} disabled={loading}>
          {loading ? 'Consultando ARCA…' : 'Consultar parámetros WSFE'}
        </button>
      </div>

      {error ? <p className="alert" style={{ marginTop: 12 }}>{error}</p> : null}

      {snapshot ? (
        <div style={{ marginTop: 16 }}>
          <p className="muted" style={{ fontSize: 12 }}>
            Última consulta: {new Date(snapshot.fetchedAt).toLocaleString('es-AR')}
          </p>

          <div style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Puntos de venta</h3>
            {snapshot.pointsOfSale.length === 0 ? (
              <p className="muted">ARCA no devolvió puntos de venta electrónicos habilitados.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '7px 8px' }}>Número</th>
                      <th style={{ textAlign: 'left', padding: '7px 8px' }}>Emisión</th>
                      <th style={{ textAlign: 'left', padding: '7px 8px' }}>Bloqueado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.pointsOfSale.map((row) => (
                      <tr key={row.number}>
                        <td style={{ padding: '7px 8px', borderTop: '1px solid var(--border, #e5e7eb)' }}>{row.number}</td>
                        <td style={{ padding: '7px 8px', borderTop: '1px solid var(--border, #e5e7eb)' }}>{row.emissionType ?? '—'}</td>
                        <td style={{ padding: '7px 8px', borderTop: '1px solid var(--border, #e5e7eb)' }}>{row.blocked == null ? '—' : row.blocked ? 'Sí' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Table title="Tipos de comprobante" rows={snapshot.voucherTypes} />
          <Table title="Tipos de documento" rows={snapshot.documentTypes} />
          <Table title="Conceptos" rows={snapshot.conceptTypes} />
          <Table title="Alícuotas de IVA" rows={snapshot.vatRates} />
          <Table title="Condición de IVA del receptor" rows={snapshot.receiverVatConditions} extraLabel="Clase de comprobante" />
        </div>
      ) : null}
    </div>
  );
}
