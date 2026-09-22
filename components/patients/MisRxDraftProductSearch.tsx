'use client';

import { FormEvent, useEffect, useState } from 'react';
import { addPrescriptionItem } from '@/app/(protected)/patients/prescription-actions';
import { getMisRxMaxProducts } from '@/lib/misrx/convention-rules';

type Convention = {
  convenio_id: number;
  nombre: string;
};

type Product = {
  code?: string;
  descripcion?: string;
  producto_id?: number;
  nombre?: string;
  presentacion?: string;
  potencia?: string;
  laboratorio?: string;
  monodroga?: string;
};

export function MisRxDraftProductSearch({
  patientId,
  prescriptionId,
  connected,
  initialConventionId,
  currentItemCount,
}: {
  patientId: string;
  prescriptionId: string;
  connected: boolean;
  initialConventionId?: number | null;
  currentItemCount: number;
}) {
  const [conventions, setConventions] = useState<Convention[]>([]);
  const [conventionId, setConventionId] = useState(initialConventionId ? String(initialConventionId) : '');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const selectedConventionId = conventionId ? Number(conventionId) : null;
  const maxProducts = getMisRxMaxProducts(selectedConventionId);
  const atProductLimit = Boolean(maxProducts && currentItemCount >= maxProducts);

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
        if (!cancelled) setConventions(Array.isArray(body?.data) ? body.data : []);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'No se pudieron cargar los convenios');
      });

    return () => {
      cancelled = true;
    };
  }, [connected]);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSelected(null);
    setProducts([]);
    setMessage('');

    if (atProductLimit) {
      setMessage(`Este convenio admite como máximo ${maxProducts} medicamentos por receta.`);
      return;
    }

    if (!conventionId) {
      setMessage('Seleccioná primero un convenio.');
      return;
    }
    if (query.trim().length < 2) {
      setMessage('Escribí al menos 2 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        patient_id: patientId,
        convenio_id: conventionId,
        q: query.trim(),
      });
      const response = await fetch(`/api/integrations/misrx/products?${params.toString()}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'No se pudieron buscar medicamentos');
      setProducts(Array.isArray(body?.data) ? body.data : []);
      if (!Array.isArray(body?.data) || body.data.length === 0) {
        setMessage('No se encontraron medicamentos para esa búsqueda.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron buscar medicamentos');
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <p className="alert">
        Conectá primero la cuenta MisRX del profesional desde Configuración para consultar convenios y medicamentos.
      </p>
    );
  }

  return (
    <div className="stack">
      {atProductLimit ? (
        <p className="alert" style={{ marginBottom: 0 }}>
          Este convenio admite como máximo {maxProducts} medicamentos por receta. Quitá uno del borrador para agregar otro.
        </p>
      ) : null}

      <form onSubmit={search} className="form-grid">
        <label>
          Convenio
          <select value={conventionId} onChange={(event) => setConventionId(event.target.value)} required>
            <option value="">Seleccionar convenio</option>
            {conventions.map((item) => (
              <option key={item.convenio_id} value={item.convenio_id}>{item.nombre}</option>
            ))}
          </select>
        </label>
        <label>
          Buscar medicamento
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={100}
            placeholder="Marca, droga o presentación"
            disabled={atProductLimit}
          />
        </label>
        <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
          <button className="btn secondary" type="submit" disabled={loading || atProductLimit}>
            {loading ? 'Buscando…' : 'Buscar en MisRX'}
          </button>
        </div>
      </form>

      {message ? <p className="field-hint">{message}</p> : null}

      {!atProductLimit && products.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          {products.slice(0, 20).map((product, index) => (
            <button
              key={String(product.producto_id ?? product.code ?? index)}
              type="button"
              className="integration-row"
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setSelected(product)}
            >
              <strong>{product.nombre || product.descripcion || product.monodroga || 'Medicamento'}</strong>
              <span className="integration-row-desc">
                {[product.presentacion, product.potencia, product.laboratorio].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!atProductLimit && selected?.producto_id ? (
        <form action={addPrescriptionItem} className="form-grid">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="prescriptionId" value={prescriptionId} />
          <input type="hidden" name="conventionId" value={conventionId} />
          <input type="hidden" name="providerProductId" value={selected.producto_id} />
          <input type="hidden" name="providerProductCode" value={selected.code ?? ''} />
          <input type="hidden" name="brand" value={selected.nombre ?? selected.descripcion ?? ''} />
          <input type="hidden" name="genericName" value={selected.monodroga ?? ''} />
          <input type="hidden" name="presentation" value={selected.presentacion ?? ''} />
          <input type="hidden" name="potency" value={selected.potencia ?? ''} />
          <input type="hidden" name="laboratory" value={selected.laboratorio ?? ''} />

          <div style={{ gridColumn: '1 / -1' }}>
            <strong>{selected.nombre || selected.descripcion || selected.monodroga}</strong>
            <p className="field-hint" style={{ marginBottom: 0 }}>
              {[selected.monodroga, selected.presentacion, selected.potencia, selected.laboratorio].filter(Boolean).join(' · ')}
            </p>
          </div>
          <label>
            Cantidad
            <input name="quantity" type="number" min="1" max="100" step="1" defaultValue="1" required />
          </label>
          <label>
            Cobertura %
            <input name="coveragePercentage" type="number" min="0" max="100" step="1" />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="printBrand" />
            Imprimir marca
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="substitutable" defaultChecked />
            Sustituible
          </label>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button className="btn" type="submit">Agregar al borrador</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
