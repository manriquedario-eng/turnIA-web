import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createService, updateService } from './actions';
import { EmptyState } from '@/components/ui/EmptyState';

type SearchParams = Promise<{ ok?: string; error?: string }>;

export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, tenantId } = await requireTenant();
  const params = await searchParams;

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name, duration_minutes, price, deposit, currency')
    .eq('tenant_id', tenantId)
    .order('name');

  if (error) throw new Error(`No se pudieron cargar los servicios: ${error.message}`);

  return (
    <section className="stack">
      <p style={{ margin: 0 }}><Link href="/settings">← Volver a Configuración</Link></p>
      <div className="page-header">
        <div>
          <h1>Servicios</h1>
          <p className="muted">Administrá prestaciones, duración y valores.</p>
        </div>
      </div>

      <div className="section-tabs">
        <Link href="/settings">Preferencias</Link>
        <Link href="/settings#integraciones">Integraciones</Link>
        <Link href="/settings#facturacion">Facturación</Link>
        <Link href="/services" className="active">Servicios</Link>
      </div>

      {params.ok ? <p className="alert success">{params.ok}</p> : null}
      {params.error ? <p className="alert error">{params.error}</p> : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Nuevo servicio</h2>
        <form action={createService} className="form-grid">
          <input type="hidden" name="return_to" value="/services" />
          <label>
            Nombre
            <input name="name" required minLength={2} maxLength={120} />
          </label>
          <label>
            Duración (minutos)
            <input name="duration_minutes" type="number" min="1" max="1440" required />
          </label>
          <label>
            Precio
            <input name="price" type="number" min="0" step="0.01" />
          </label>
          <label>
            Seña
            <input name="deposit" type="number" min="0" step="0.01" />
          </label>
          <label>
            Moneda
            <input name="currency" defaultValue="ARS" minLength={3} maxLength={3} required />
          </label>
          <div className="form-actions">
            <button className="btn" type="submit">Crear servicio</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Servicios cargados</h2>
        {(services ?? []).length === 0 ? (
          <EmptyState title="Todavía no hay servicios cargados" description="Creá el primero con el formulario de arriba." />
        ) : (
          <div className="stack" style={{ gap: 14, marginTop: 8 }}>
            {(services ?? []).map((service) => (
              <div key={service.id} style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 14 }}>
                <div className="nav" style={{ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' }}>
                  <strong>{service.name}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {service.duration_minutes} min · {service.currency ?? 'ARS'} {Number(service.price ?? 0).toLocaleString('es-AR')}
                  </span>
                </div>
                <form action={updateService} className="form-grid">
                  <input type="hidden" name="id" value={service.id} />
                  <input type="hidden" name="return_to" value="/services" />
                  <label>
                    Nombre
                    <input name="name" defaultValue={service.name} required minLength={2} maxLength={120} />
                  </label>
                  <label>
                    Duración (minutos)
                    <input name="duration_minutes" type="number" min="1" max="1440" defaultValue={service.duration_minutes} required />
                  </label>
                  <label>
                    Precio
                    <input name="price" type="number" min="0" step="0.01" defaultValue={service.price ?? ''} />
                  </label>
                  <label>
                    Seña
                    <input name="deposit" type="number" min="0" step="0.01" defaultValue={service.deposit ?? ''} />
                  </label>
                  <label>
                    Moneda
                    <input name="currency" defaultValue={service.currency ?? 'ARS'} minLength={3} maxLength={3} required />
                  </label>
                  <div className="form-actions">
                    <button className="btn secondary" type="submit">Guardar cambios</button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
