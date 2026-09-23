'use client';

import { useEffect, useRef, useState } from 'react';
import { addPrescriptionItem } from '@/app/(protected)/patients/prescription-actions';
import { getMisRxMaxProducts } from '@/lib/misrx/convention-rules';

type Convention = {
  convenio_id: number;
  permite_sustitucion?: boolean;
  solo_marca?: number;
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
  initialAffiliateId,
  initialPlanId,
  currentItemCount,
}: {
  patientId: string;
  prescriptionId: string;
  connected: boolean;
  initialConventionId?: number | null;
  initialAffiliateId?: number | null;
  initialPlanId?: number | null;
  currentItemCount: number;
}) {
  const [conventionId, setConventionId] = useState(initialConventionId ? String(initialConventionId) : '');
  const [affiliateId, setAffiliateId] = useState(initialAffiliateId ?? null);
  const [planId, setPlanId] = useState(initialPlanId ?? null);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [allowSubstitution, setAllowSubstitution] = useState(true);
  const [forceBrand, setForceBrand] = useState(false);
  const [coveragePercentage, setCoveragePercentage] = useState<number | null>(null);
  const selectedPanelRef = useRef<HTMLFormElement | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const selectedConventionId = conventionId ? Number(conventionId) : null;
  const maxProducts = getMisRxMaxProducts(selectedConventionId);
  const atProductLimit = Boolean(maxProducts && currentItemCount >= maxProducts);

  useEffect(() => {
    function handleDraftContext(event: Event) {
      const detail = (event as CustomEvent<{
        prescriptionId?: string;
        conventionId?: number | null;
        affiliateId?: number | null;
        planId?: number | null;
      }>).detail;

      if (!detail || detail.prescriptionId !== prescriptionId) return;

      setConventionId(detail.conventionId ? String(detail.conventionId) : '');
      setAffiliateId(detail.affiliateId ?? null);
      setPlanId(detail.planId ?? null);
      setProducts([]);
      setSelected(null);
      setMessage('');
    }

    window.addEventListener('misrx-draft-context', handleDraftContext);
    return () => window.removeEventListener('misrx-draft-context', handleDraftContext);
  }, [prescriptionId]);

  useEffect(() => {
    if (!connected || !conventionId || !planId) {
      setCoveragePercentage(null);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      convenio_id: conventionId,
      afiliado_id: affiliateId ? String(affiliateId) : '',
    });

    fetch(`/api/integrations/misrx/plans?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error('No se pudo obtener la cobertura del plan');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const rows = Array.isArray(body?.data) ? body.data as Array<{ plan_id?: number; porc_cobertura?: number }> : [];
        const plan = rows.find((item) => Number(item.plan_id) === Number(planId));
        setCoveragePercentage(typeof plan?.porc_cobertura === 'number' ? plan.porc_cobertura : null);
      })
      .catch(() => {
        if (!cancelled) setCoveragePercentage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, conventionId, affiliateId, planId]);

  useEffect(() => {
    if (!connected || !conventionId) return;
    let cancelled = false;

    fetch('/api/integrations/misrx/conventions', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error('No se pudieron cargar las reglas del convenio');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const rows = Array.isArray(body?.data) ? body.data as Convention[] : [];
        const convention = rows.find((item) => String(item.convenio_id) === conventionId);
        setAllowSubstitution(convention?.permite_sustitucion !== false);
        setForceBrand(Number(convention?.solo_marca ?? 0) !== 0);
      })
      .catch(() => {
        if (!cancelled) {
          setAllowSubstitution(true);
          setForceBrand(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connected, conventionId]);

  async function search(queryOverride?: string) {
    const term = (queryOverride ?? query).trim();
    setSelected(null);
    setProducts([]);
    setMessage('');

    if (atProductLimit) {
      setMessage(`Este convenio admite como máximo ${maxProducts} medicamentos por receta.`);
      return;
    }

    if (!conventionId) {
      setMessage('Primero elegí el convenio en el paso anterior y guardá los datos de la receta.');
      return;
    }

    if (term.length < 2) {
      setMessage('Escribí al menos 2 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        patient_id: patientId,
        convenio_id: conventionId,
        q: term,
      });
      if (planId) params.set('plan_id', String(planId));

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      const timeout = window.setTimeout(() => controller.abort(), 12000);
      const response = await fetch(`/api/integrations/misrx/products?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'No se pudieron buscar medicamentos');
      setProducts(Array.isArray(body?.data) ? body.data : []);
      if (!Array.isArray(body?.data) || body.data.length === 0) {
        setMessage('No se encontraron medicamentos para esa búsqueda.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessage('La búsqueda tardó demasiado. Volvé a intentar.');
      } else {
        setMessage(error instanceof Error ? error.message : 'No se pudieron buscar medicamentos');
      }
    } finally {
      setLoading(false);
    }
  }

  function selectProduct(product: Product) {
    setSelected(product);
    window.setTimeout(() => {
      selectedPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const quantityInput = selectedPanelRef.current?.querySelector<HTMLInputElement>('input[name="quantity"]');
      quantityInput?.focus();
      quantityInput?.select();
    }, 50);
  }

  if (!connected) {
    return (
      <p className="alert">
        Conectá primero la cuenta MisRX del profesional desde Configuración para consultar medicamentos.
      </p>
    );
  }

  if (!conventionId) {
    return (
      <p className="alert" style={{ marginBottom: 0 }}>
        Elegí el convenio y validá el afiliado antes de buscar medicamentos. TurnIA guarda esos datos automáticamente.
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="misrx-search-context">
        <span className="field-hint">Convenio guardado</span>
        <strong>ID {conventionId}</strong>
        {maxProducts ? <span className="badge badge-neutral">Máximo {maxProducts} medicamentos</span> : null}
      </div>

      {atProductLimit ? (
        <p className="alert" style={{ marginBottom: 0 }}>
          Este convenio admite como máximo {maxProducts} medicamentos por receta. Quitá uno del borrador para agregar otro.
        </p>
      ) : null}

      <div className="form-grid">
        <label style={{ gridColumn: '1 / -1' }}>
          Buscar medicamento
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            minLength={2}
            maxLength={100}
            placeholder="Marca, droga o presentación"
            disabled={atProductLimit}
          />
        </label>
        <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
          <button className="btn secondary" type="button" onClick={() => void search()} disabled={loading || atProductLimit}>
            {loading ? 'Buscando…' : 'Buscar en MisRX'}
          </button>
        </div>
      </div>

      {message ? <p className="field-hint">{message}</p> : null}

      {!atProductLimit && products.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          {products.slice(0, 20).map((product, index) => (
            <button
              key={String(product.producto_id ?? product.code ?? index)}
              type="button"
              className={`misrx-choice-button${selected?.producto_id === product.producto_id ? ' is-selected' : ''}`}
              onClick={() => selectProduct(product)}
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
        <form ref={selectedPanelRef} action={addPrescriptionItem} className="form-grid misrx-selected-product">
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
          <div>
            <span className="field-label">Cobertura</span>
            {coveragePercentage != null ? (
              <>
                <strong style={{ display: 'block', marginTop: 6 }}>{coveragePercentage}%</strong>
                <span className="field-hint">Tomada automáticamente del plan informado por MisRX.</span>
                <input type="hidden" name="coveragePercentage" value={coveragePercentage} />
              </>
            ) : (
              <>
                <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
                  MisRX no informó un porcentaje de cobertura para el plan seleccionado. No se completa manualmente.
                </span>
                <input type="hidden" name="coveragePercentage" value="" />
              </>
            )}
          </div>
          {forceBrand ? (
            <label className="checkbox-field">
              <input type="checkbox" checked disabled readOnly />
              Imprimir marca
              <input type="hidden" name="printBrand" value="true" />
              <span className="field-hint">Este convenio prescribe obligatoriamente por marca.</span>
            </label>
          ) : (
            <label className="checkbox-field">
              <input type="checkbox" name="printBrand" />
              Imprimir marca
            </label>
          )}
          <label className="checkbox-field">
            <input
              type="checkbox"
              name="substitutable"
              defaultChecked={allowSubstitution}
              disabled={!allowSubstitution}
            />
            Sustituible
            {!allowSubstitution ? (
              <span className="field-hint">Este convenio no permite sustitución.</span>
            ) : null}
          </label>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button className="btn" type="submit">Añadir a la receta</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
